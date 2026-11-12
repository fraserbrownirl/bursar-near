import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { isNearAccount } from "./account.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, formatCheck, type ChainFacts } from "./decide.js";
import { loadFacts } from "./load.js";
import { decimalsFor, loadTokens } from "./decimals.js";
import { plainAmounts } from "./model.js";
import { checkIntentInModel, checkQuoteInModel } from "./model-checks.js";
import { readPayeeMap } from "./payees.js";
import { settle } from "./pay.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { touchSigner } from "./signer.js";

function emptyFacts(): ChainFacts {
  return { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };
}

export type Args = {
  receiver: string;
  amount?: string;
  token?: string;
  request?: string;
};

export class UsageError extends Error {}

function usage(): never {
  throw new UsageError(
    "bursar check <receiver> [--amount <amount>] [--token <token>] [--request <text>]\n"
    + "bursar pay --to <recipient> --amount <atomic> --origin <assetId> --dest <assetId> [--min-out <atomic>] [--fixture <quote.json>] [--request <text>]\n"
    +     "bursar fund --origin <assetId> --amount <atomic>\n"
    + "bursar anchor\n"
    + "bursar agent \"<request>\"\n"
    + "bursar mcp\n"
    + "bursar signer account\n"
    + "bursar code\n"
    + "bursar scan <png>\n"
    + "bursar history --csv\n"
    + "bursar demo\n"
    + "bursar balance\n"
    + "bursar pay <url>\n"
    + "bursar find \"<need>\"\n"
    + "bursar merchant --mpp [--port 8402] [--name <name>] [--to <base address>]\n"
    + "bursar merchant --attack <inject|inflate|switch|pressure> [--port 8402]\n"
    + "bursar log --verify",
  );
}

export function parseArgs(argv: readonly string[]): Args {
  if (argv[0] !== "check" || !argv[1] || argv[1].startsWith("--")) usage();
  const args: Args = { receiver: argv[1] };
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !value || value.startsWith("--")) usage();
    if (flag === "--amount") args.amount = value;
    else if (flag === "--token") args.token = value;
    else if (flag === "--request") args.request = value;
    else usage();
  }
  return args;
}

async function printAmounts(request: BursarRequest, quotedMin: string): Promise<string> {
  try {
    const rows = await loadTokens(false);
    const origin = decimalsFor(request.originAsset, rows);
    const dest = decimalsFor(request.destinationAsset, rows);
    return await plainAmounts(request, quotedMin, origin, dest) + "\n";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("STOP:")) return message + "\n";
    throw error;
  }
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) usage();
  return value;
}

async function pay(argv: readonly string[]): Promise<void> {
  const to = flagValue(argv, "--to");
  const amount = flagValue(argv, "--amount");
  const origin = flagValue(argv, "--origin");
  const dest = flagValue(argv, "--dest");
  const minOut = flagValue(argv, "--min-out") ?? "0";
  const fixture = flagValue(argv, "--fixture");
  const requestText = flagValue(argv, "--request");
  if (!to || !amount || !origin || !dest) usage();
  const { enclaveIdentity } = await import("./signer.js");
  const accountId = fixture ? process.env.BURSAR_NEAR_ACCOUNT : (await enclaveIdentity()).accountId;
  if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
  const nowMs = Date.now();
  const request: BursarRequest = {
    recipient: to,
    refundTo: accountId,
    amount,
    originAsset: origin,
    destinationAsset: dest,
    deadline: new Date(nowMs + 4 * 60 * 1000).toISOString(),
    minAmountOut: minOut,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
  };
  const response = fixture
    ? JSON.parse(readFileSync(fixture, "utf8")) as SignedQuote
    : await OneClickService.getQuote({
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "INTENTS",
      slippageTolerance: 100,
      originAsset: origin,
      destinationAsset: dest,
      amount,
      recipient: to,
      recipientType: isNearAccount(to) ? "INTENTS" : "DESTINATION_CHAIN",
      refundTo: accountId,
      refundType: "INTENTS",
      deadline: request.deadline,
    } as never) as SignedQuote;
  const nowSec = Math.floor(nowMs / 1000);
  const quoteStop = reviewQuote(response, request, nowSec);
  if (quoteStop) {
    process.stdout.write(quoteStop + "\n");
    return;
  }
  const quoteCheck = await checkQuoteInModel(response, request, nowSec);
  process.stdout.write(quoteCheck.lines + "\n");
  if (quoteCheck.stop) {
    process.stdout.write(quoteCheck.stop + "\n");
    return;
  }
  const plain = await printAmounts(request, response.quote.minAmountOut);
  process.stdout.write(plain);
  const facts = isNearAccount(to) ? await loadFacts(to) : emptyFacts();
  const check = decide({
    receiver: to,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount,
    token: dest,
    request: requestText,
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(to),
  });
  process.stdout.write(formatCheck(check) + "\n");
  if (check.verdict === "block") {
    process.stdout.write("STOP\n");
    return;
  }
  if (check.verdict === "warn") {
    const { askApprove } = await import("./agent.js");
    const yes = await askApprove(check.reasons, plain);
    if (!yes) {
      process.stdout.write("STOP\n");
      return;
    }
  }
  process.stdout.write(`depositAddress: ${response.quote.depositAddress ?? ""}\n`);
  if (fixture) {
    process.stdout.write("fixture replay: not submitted\n");
    return;
  }
  let exactPayload = "";
  const signer = await touchSigner(accountId, response, () => nowMs, () => exactPayload || undefined);
  const line = await settle({
    quote: response,
    request,
    accountId,
    nowSec,
    signer,
    checkIntent: (generated) => checkIntentInModel(generated, accountId).then((result) => {
      process.stdout.write(result.lines + "\n");
      return result.stop;
    }),
    generateIntent: async (depositAddress, signerId) => {
      const webauthn = !/^[0-9a-f]{64}$/i.test(signerId);
      const generated = await OneClickService.generateIntent({
        type: "swap_transfer",
        standard: webauthn ? "webauthn" : "nep413",
        signerId,
        depositAddress,
      } as never) as { intent: { payload: { message: string; nonce: string; recipient: string } | string } };
      if (typeof generated.intent.payload !== "string") return generated as { intent: { payload: { message: string; nonce: string; recipient: string } } };
      exactPayload = generated.intent.payload;
      const parsed = JSON.parse(exactPayload) as { deadline: string; nonce: string; verifying_contract: string; signer_id: string; intents: unknown };
      return {
        intent: {
          payload: {
            message: JSON.stringify({ deadline: parsed.deadline, intents: parsed.intents, signer_id: parsed.signer_id }),
            nonce: parsed.nonce,
            recipient: parsed.verifying_contract,
          },
        },
      };
    },
    submitIntent: async (signed) => OneClickService.submitIntent({ type: "swap_transfer", signedData: signed } as never),
  });
  process.stdout.write(line + "\n");
}

async function fund(argv: readonly string[]): Promise<void> {
  const origin = flagValue(argv, "--origin");
  const amount = flagValue(argv, "--amount");
  const accountId = process.env.BURSAR_NEAR_ACCOUNT;
  if (!origin || !amount) usage();
  if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
  const nowMs = Date.now();
  const deadline = new Date(nowMs + 4 * 60 * 1000).toISOString();
  const request: BursarRequest = {
    recipient: accountId,
    refundTo: accountId,
    amount,
    originAsset: origin,
    destinationAsset: origin,
    deadline,
    minAmountOut: "0",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
  };
  const response = await OneClickService.getQuote({
    dry: false,
    swapType: "EXACT_INPUT",
    depositType: "INTENTS",
    slippageTolerance: 100,
    originAsset: origin,
    destinationAsset: origin,
    amount,
    recipient: accountId,
    recipientType: "INTENTS",
    refundTo: accountId,
    refundType: "INTENTS",
    deadline,
  } as never) as SignedQuote;
  const quoteStop = reviewQuote(response, request, Math.floor(nowMs / 1000));
  if (quoteStop) {
    process.stdout.write(quoteStop + "\n");
    return;
  }
  process.stdout.write(`depositAddress: ${response.quote.depositAddress ?? ""}\n`);
  process.stdout.write(await printAmounts(request, response.quote.minAmountOut));
}

async function main(): Promise<void> {
  const { selfTestModel } = await import("./model.js");
  await selfTestModel();
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    const { createInterface } = await import("node:readline");
    const { Talk, talkSession, READY } = await import("./agent.js");
    const { enclaveIdentity } = await import("./signer.js");
    const accountId = (await enclaveIdentity()).accountId;
    process.stdout.write(`${READY}\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    const lines = (async function* () {
      try {
        rl.prompt();
        for await (const line of rl) {
          const text = line.trim();
          if (text === "exit" || text === "quit") return;
          yield line;
          rl.prompt();
        }
      } finally {
        rl.close();
      }
    })();
    await talkSession(lines, accountId, new Talk());
    return;
  }
  if (argv[0] === "fund") {
    await fund(argv.slice(1));
    return;
  }
  if (argv[0] === "balance") {
    const accountId = process.env.BURSAR_NEAR_ACCOUNT;
    if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
    const { balanceReport } = await import("./base-float.js");
    process.stdout.write(await balanceReport(accountId) + "\n");
    return;
  }
  if (argv[0] === "find") {
    const need = argv.slice(1).join(" ").trim();
    if (!need) usage();
    const { findReport } = await import("./catalog.js");
    process.stdout.write(await findReport(need) + "\n");
    return;
  }
  if (argv[0] === "pay" && argv[1] && /^https?:\/\//.test(argv[1])) {
    const { payCatalog } = await import("./catalog-pay.js");
    process.exit(await payCatalog(argv[1]));
  }
  if (argv[0] === "pay") {
    await pay(argv.slice(1));
    return;
  }
  if (argv[0] === "pays") {
    const url = argv[1] && !argv[1].startsWith("--") ? argv[1] : "http://127.0.0.1:8402/";
    if (argv[1]?.startsWith("--")) usage();
    const { enclaveIdentity } = await import("./signer.js");
    const { payUrl } = await import("./mpp-pay.js");
    process.exit(await payUrl(url, (await enclaveIdentity()).accountId));
  }
  if (argv[0] === "log" && argv[1] === "--verify") {
    const { verify, head, ledgerPath } = await import("./guard/ledger.js");
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { dir } = await import("./store.js");
    const result = verify();
    const anchoredPath = join(dir(), "anchor.txt");
    const anchored = existsSync(anchoredPath) ? readFileSync(anchoredPath, "utf8").trim() : "";
    const top = head();
    if (!result.ok) {
      process.stdout.write(`STOP: ledger line ${result.badAt}: ${result.problem}\n`);
      if (anchored) process.stdout.write(`anchor ${anchored} does not match a verified head\n`);
      process.stdout.write(`file ${ledgerPath()}\n`);
      process.exit(1);
    }
    if (anchored && anchored !== top.hash) {
      process.stdout.write(`STOP: anchor ${anchored} does not match ${top.hash}\n`);
      process.exit(1);
    }
    process.stdout.write(`ok ${result.entries} ${result.head}\n`);
    return;
  }
  if (argv[0] === "merchant") {
    if (argv[1] === "--attack") {
      const mode = flagValue(argv, "--attack");
      if (!mode) usage();
      const port = Number(flagValue(argv, "--port") ?? "8402");
      const { serveAttack } = await import("./merchant.js");
      await serveAttack({ mode, port });
      await new Promise(() => undefined);
    }
    if (argv[1] !== "--mpp") usage();
    const port = Number(flagValue(argv, "--port") ?? "8402");
    const name = flagValue(argv, "--name") ?? "demo merchant";
    const to = flagValue(argv, "--to") ?? process.env.BURSAR_MERCHANT_BASE;
    if (!to) throw new Error("BURSAR_MERCHANT_BASE or --to is the Base address that receives USDC");
    const { serveMerchant } = await import("./merchant.js");
    const jwt = process.env.ONE_CLICK_JWT;
    await serveMerchant({
      destinationRecipient: to,
      name,
      port,
      ...(jwt ? { jwt } : {}),
    });
    await new Promise(() => undefined);
  }
  if (argv[0] === "anchor") {
    const { anchorLedger } = await import("./anchor.js");
    const sent = await anchorLedger();
    process.stdout.write(`${sent.url}\n`);
    return;
  }
  if (argv[0] === "history") {
    if (argv[1] !== "--csv") usage();
    const { historyCsv } = await import("./history.js");
    process.stdout.write(historyCsv());
    return;
  }
  if (argv[0] === "signer" && argv[1] === "account") {
    const { enclaveIdentity } = await import("./signer.js");
    const identity = await enclaveIdentity();
    process.stdout.write(`${identity.accountId}\n${identity.publicKey}\n`);
    return;
  }
  if (argv[0] === "signer" && argv[1] === "sweep") {
    const { sweepAfterPremium } = await import("./sweep.js");
    process.stdout.write(await sweepAfterPremium() + "\n");
    return;
  }
  if (argv[0] === "mcp") {
    const { serveMcp } = await import("./mcp.js");
    await serveMcp();
    return;
  }
  if (argv[0] === "agent") {
    const text = argv.slice(1).join(" ").trim();
    const { runAgent } = await import("./agent.js");
    const { enclaveIdentity } = await import("./signer.js");
    const report = await runAgent(text, (await enclaveIdentity()).accountId);
    process.stdout.write(report.text + "\n");
    process.exit(report.code);
  }
  if (argv[0] === "demo") {
    const { demoReport } = await import("./demo.js");
    const report = demoReport();
    process.stdout.write(report.text + "\n");
    process.exit(report.code);
  }
  if (argv[0] === "code") {
    if (argv.length !== 1) usage();
    const { enclaveIdentity } = await import("./signer.js");
    const { writeAccountCode } = await import("./code.js");
    process.stdout.write(await writeAccountCode((await enclaveIdentity()).accountId));
    return;
  }
  if (argv[0] === "scan") {
    const file = argv[1];
    if (!file || file.startsWith("--") || argv.length !== 2) usage();
    const { decode } = await import("./code.js");
    let text: string;
    try {
      text = decode(readFileSync(file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "STOP: account") throw error;
      text = message;
    }
    process.stdout.write(`${text}\n`);
    if (text === "STOP: account") process.exit(1);
    return;
  }
  const commands = new Set(["check", "pay", "fund", "balance", "find", "pays", "merchant", "anchor", "history", "signer", "mcp", "agent", "demo", "code", "scan"]);
  if (!commands.has(argv[0])) {
    const { runAgent } = await import("./agent.js");
    const { enclaveIdentity } = await import("./signer.js");
    const report = await runAgent(argv.join(" "), (await enclaveIdentity()).accountId);
    process.stdout.write(report.text.endsWith("\n") ? report.text : `${report.text}\n`);
    process.exit(report.code);
  }
  const args = parseArgs(argv);
  const facts = isNearAccount(args.receiver) ? await loadFacts(args.receiver) : emptyFacts();
  const result = decide({
    receiver: args.receiver,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount: args.amount,
    token: args.token,
    request: args.request,
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(args.receiver),
  });
  process.stdout.write(formatCheck(result) + "\n");
}

function loadDotEnv(): void {
  const path = new URL("../.env", import.meta.url);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const isDirect = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  loadDotEnv();
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
