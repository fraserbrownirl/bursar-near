import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNearAccount, recipientTypeFor } from "./account.js";
import { baseEncode } from "@near-js/utils";
import { pricePayment, rowsFor, type TokenRow } from "./assets.js";
import { checkIntentInModel, checkQuoteInModel, requireLive, type ModelCheck } from "./model-checks.js";
import type { GeneratedIntent } from "./pay.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { p256LowS, webAuthnFields } from "./signer.js";
import { dir } from "./store.js";
import { generateSwapIntent } from "./swap-intent.js";

/** The model server listens here. This relay does not bind it. */
export const MODEL_PORT = 8000;

export type CheckBody = {
  quote: SignedQuote;
  request: BursarRequest;
  nowSec: number;
  intent: GeneratedIntent;
  accountId: string;
};

export type PrepareInput = {
  accountId: string;
  recipient: string;
  human: string;
  chain: string;
};

export type Prepared =
  | { ok: true; signText: string; depositAddress: string; check: CheckBody }
  | { ok: false; stop: string };

export type CheckResult =
  | { ok: true; quoteReceipt: string; intentReceipt: string }
  | { ok: false; stop: string };

/** What the phone signs and sends back. `signature` is the enclave's raw r||s, hex. */
export type SubmitBody = {
  payload: string;
  publicKey: string;
  signature: string;
  clientDataJson: string;
  authenticatorData: string;
  deposit: string;
};

export type SubmitResult =
  | { ok: true; hash: string }
  | { ok: false; stop: string };

type PrepareDeps = {
  nowMs: () => number;
  rows: (chain: string) => Promise<TokenRow[]>;
  review: (quote: SignedQuote, request: BursarRequest, nowSec: number) => string | null;
  quote: (request: BursarRequest) => Promise<SignedQuote>;
  generate: (deposit: string, signerId: string, exact: { text: string }) => Promise<GeneratedIntent>;
};

/** A port for this relay. Port 8000 is the model server. Zero asks the OS for a free port. */
export function relayPort(value: number): number {
  if (value === MODEL_PORT) throw new Error("STOP: model port");
  if (value !== 0 && (!Number.isInteger(value) || value < 1 || value > 65535)) throw new Error("STOP: port");
  return value;
}

/** The receipt hash when the model ran the check and it passed. Anything else is not a pass. */
export function passingReceipt(check: ModelCheck): string | null {
  if (requireLive(check)) return null;
  return check.lines.match(/receipt ([0-9a-f]{64})/)?.[1] ?? null;
}

/**
 * Forwards the quote check, then the intent check, to the model.
 * A stop or a missing receipt is not a passing result, and the intent check
 * is not sent once the quote check has failed.
 */
export async function forwardChecks(
  body: CheckBody,
  run: {
    quote: typeof checkQuoteInModel;
    intent: typeof checkIntentInModel;
  } = { quote: checkQuoteInModel, intent: checkIntentInModel },
): Promise<CheckResult> {
  const quote = await run.quote(body.quote, body.request, body.nowSec);
  const quoteReceipt = passingReceipt(quote);
  if (!quoteReceipt) return { ok: false, stop: requireLive(quote) ?? "STOP: in-model check" };
  const intent = await run.intent(body.intent, body.accountId);
  const intentReceipt = passingReceipt(intent);
  if (!intentReceipt) return { ok: false, stop: requireLive(intent) ?? "STOP: in-model check" };
  return { ok: true, quoteReceipt, intentReceipt };
}

/** A 1Click quote and an unsigned intent. The model is not called. */
export async function preparePayment(input: PrepareInput, over: Partial<PrepareDeps> = {}): Promise<Prepared> {
  const deps: PrepareDeps = {
    nowMs: () => Date.now(),
    rows: (chain) => rowsFor("USDC", chain || "near"),
    review: reviewQuote,
    quote: liveQuote,
    generate: (deposit, signerId, exact) => generateSwapIntent(deposit, signerId, exact),
    ...over,
  };
  const chain = input.chain || (isNearAccount(input.recipient) ? "near" : "");
  const priced = pricePayment(await deps.rows(chain), {
    to: input.recipient,
    human: input.human,
    asset: "USDC",
    chain,
  });
  if ("ask" in priced) return { ok: false, stop: priced.ask };
  const nowMs = deps.nowMs();
  const request: BursarRequest = {
    recipient: input.recipient,
    refundTo: input.accountId,
    amount: priced.amount,
    originAsset: priced.origin.assetId,
    destinationAsset: priced.dest.assetId,
    deadline: new Date(nowMs + 4 * 60 * 1000).toISOString(),
    minAmountOut: "0",
    swapType: priced.swapType,
    slippageTolerance: 100,
  };
  const quote = await deps.quote(request);
  const nowSec = Math.floor(nowMs / 1000);
  const quoteStop = deps.review(quote, request, nowSec);
  if (quoteStop) return { ok: false, stop: quoteStop };
  const deposit = quote.quote.depositAddress;
  if (!deposit) return { ok: false, stop: "STOP: deposit" };
  const exact = { text: "" };
  const intent = await deps.generate(deposit, input.accountId, exact);
  if (!exact.text) return { ok: false, stop: "STOP: sign" };
  return {
    ok: true,
    signText: exact.text,
    depositAddress: deposit,
    check: { quote, request, nowSec, intent, accountId: input.accountId },
  };
}

type SubmitDeps = {
  submit: (signedData: Record<string, unknown>) => Promise<unknown>;
  status: (deposit: string) => Promise<{ status?: string; swapDetails?: { destinationChainTxHashes?: { hash?: string }[] } }>;
  wait: (ms: number) => Promise<void>;
  polls: number;
};

/**
 * Submits the phone's WebAuthn-signed intent. The client-data and
 * authenticator bytes are recomputed from the payload, so the signature can
 * only ever bind the payload the checks passed. A high S is folded before
 * submit, the same rule as the Mac signer. Then the destination hash is
 * polled; an empty hash means 1Click had not confirmed when the poll ended.
 */
export async function submitSigned(body: SubmitBody, over: Partial<SubmitDeps> = {}): Promise<SubmitResult> {
  if (!body.payload || !body.publicKey.startsWith("p256:")) return { ok: false, stop: "STOP: signature" };
  if (!/^[0-9a-fA-F]{128}$/.test(body.signature)) return { ok: false, stop: "STOP: signature" };
  const fields = webAuthnFields(body.payload);
  if (body.clientDataJson !== fields.clientDataJSON || body.authenticatorData !== fields.authenticatorData) {
    return { ok: false, stop: "STOP: binding" };
  }
  const deps: SubmitDeps = {
    submit: async (signedData) => {
      const { OneClickService } = await import("@defuse-protocol/one-click-sdk-typescript");
      return OneClickService.submitIntent({ type: "swap_transfer", signedData } as never);
    },
    status: async (deposit) => {
      const { OneClickService } = await import("@defuse-protocol/one-click-sdk-typescript");
      return OneClickService.getExecutionStatus(deposit) as never;
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    polls: 17,
    ...over,
  };
  const lowS = p256LowS(Buffer.from(body.signature, "hex"));
  await deps.submit({
    standard: "webauthn",
    payload: body.payload,
    public_key: body.publicKey,
    signature: `p256:${baseEncode(lowS)}`,
    client_data_json: body.clientDataJson,
    authenticator_data: body.authenticatorData,
  });
  for (let i = 0; i < deps.polls; i += 1) {
    const execution = await deps.status(body.deposit);
    const hash = execution.swapDetails?.destinationChainTxHashes?.[0]?.hash;
    if (execution.status === "SUCCESS" && hash) return { ok: true, hash };
    if (execution.status === "REFUNDED" || execution.status === "FAILED") return { ok: false, stop: `STOP: ${execution.status}` };
    if (i + 1 < deps.polls) await deps.wait(10_000);
  }
  return { ok: true, hash: "" };
}

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

/** Token for the phone. A new one is written once, mode 0600, outside the repo. */
export function relayToken(home = dir()): string {
  const fromEnv = process.env.BURSAR_MODEL_RELAY_TOKEN;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  const path = join(home, "model-relay-token");
  if (existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim();
    if (saved !== "") return saved;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  return token;
}

export function phoneConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../bursar-phone/Bursar/Relay.local.json");
}

function tokenOk(have: string, want: string): boolean {
  const left = Buffer.from(have);
  const right = Buffer.from(want);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("STOP: body"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(Array.isArray(header) ? header[0] ?? "" : header);
  return match?.[1] ?? "";
}

function isCheckBody(value: unknown): value is CheckBody {
  if (!value || typeof value !== "object") return false;
  const body = value as CheckBody;
  return Boolean(body.quote && body.request && body.intent && typeof body.accountId === "string" && typeof body.nowSec === "number");
}

function isPrepare(value: unknown): value is PrepareInput {
  if (!value || typeof value !== "object") return false;
  const body = value as PrepareInput;
  return typeof body.accountId === "string" && typeof body.recipient === "string" && typeof body.human === "string" && typeof body.chain === "string";
}

function isSubmitBody(value: unknown): value is SubmitBody {
  if (!value || typeof value !== "object") return false;
  const body = value as SubmitBody;
  return ["payload", "publicKey", "signature", "clientDataJson", "authenticatorData", "deposit"]
    .every((key) => typeof body[key as keyof SubmitBody] === "string");
}

/** Token-protected HTTP relay. It forwards checks to the model and does not bind port 8000. */
export function listenModelRelay(options: {
  token: string;
  port: number;
  host?: string;
  forward?: typeof forwardChecks;
  prepare?: (input: PrepareInput) => Promise<Prepared>;
  submit?: (body: SubmitBody) => Promise<SubmitResult>;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = relayPort(options.port);
  const forward = options.forward ?? forwardChecks;
  const prepare = options.prepare ?? ((input: PrepareInput) => preparePayment(input));
  const submit = options.submit ?? ((body: SubmitBody) => submitSigned(body));
  const server = createServer(async (req, res) => {
    if (!tokenOk(bearer(req), options.token)) {
      send(res, 401, { ok: false, stop: "STOP: token" });
      return;
    }
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    try {
      const parsed = JSON.parse(await readBody(req)) as unknown;
      if (req.method === "POST" && path === "/prepare") {
        if (!isPrepare(parsed)) {
          send(res, 200, { ok: false, stop: "STOP: check" });
          return;
        }
        send(res, 200, await prepare(parsed));
        return;
      }
      if (req.method === "POST" && path === "/check") {
        if (!isCheckBody(parsed)) {
          send(res, 200, { ok: false, stop: "STOP: check" });
          return;
        }
        send(res, 200, await forward(parsed));
        return;
      }
      if (req.method === "POST" && path === "/submit") {
        if (!isSubmitBody(parsed)) {
          send(res, 200, { ok: false, stop: "STOP: submit" });
          return;
        }
        send(res, 200, await submit(parsed));
        return;
      }
      send(res, 404, { ok: false, stop: "STOP: check" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 200, { ok: false, stop: message.startsWith("STOP:") ? message : "STOP: check" });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "0.0.0.0", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        port: bound,
        close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

/** Listens until the process exits. Does not start or rebind the model server. */
export async function serveModelRelay(): Promise<void> {
  const port = relayPort(Number(process.env.BURSAR_MODEL_RELAY_PORT ?? 8787));
  const token = relayToken();
  const relay = await listenModelRelay({ token, port });
  const baseURL = `http://${lanAddress()}:${relay.port}`;
  const phone = phoneConfigPath();
  if (existsSync(dirname(phone))) {
    writeFileSync(phone, `${JSON.stringify({ baseURL, token })}\n`, { mode: 0o600 });
  }
  process.stdout.write(`model relay ${baseURL}\n`);
  await new Promise(() => {});
}

async function liveQuote(request: BursarRequest): Promise<SignedQuote> {
  const { OneClickService } = await import("@defuse-protocol/one-click-sdk-typescript");
  return await OneClickService.getQuote({
    dry: false,
    swapType: request.swapType ?? "EXACT_INPUT",
    depositType: "INTENTS",
    slippageTolerance: request.slippageTolerance ?? 100,
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    recipient: request.recipient,
    recipientType: recipientTypeFor(request.recipient, request.destinationAsset),
    refundTo: request.refundTo,
    refundType: "INTENTS",
    deadline: request.deadline,
  } as never) as SignedQuote;
}
