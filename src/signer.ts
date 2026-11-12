import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { IIntentSigner, IntentPayload } from "@defuse-protocol/intents-sdk";
import { baseEncode } from "@near-js/utils";
import { deadlineProblem } from "./deadline.js";
import { inspectIntent, type IntentRecord } from "./intent.js";
import type { SignedQuote } from "./quote.js";

export { deadlineProblem };

export class BursarGuardedSigner implements IIntentSigner {
  private readonly usedNonces = new Set<string>();

  constructor(
    private readonly inner: IIntentSigner | null,
    private readonly options: {
      accountId: string;
      quote: SignedQuote;
      now?: () => number;
      publicKey?: string;
      /** The exact webauthn payload string from generateIntent. Key order is signed. */
      payloadText?: () => string | undefined;
      /** Test double. Production leaves this empty and the helper signs. */
      signHash?: (hash: Uint8Array) => Promise<Uint8Array>;
    },
  ) {}

  /**
   * NEP-413 recipient is `verifying_contract`. The helper runs only after these checks.
   */
  async signIntent(intent: IntentPayload): Promise<Awaited<ReturnType<IIntentSigner["signIntent"]>>> {
    if (intent.verifying_contract !== "intents.near") {
      throw new Error(`STOP: NEP-413 recipient ${intent.verifying_contract}`);
    }
    if (intent.signer_id !== this.options.accountId) {
      throw new Error(`STOP: signer_id ${String(intent.signer_id)}`);
    }
    const now = this.options.now?.() ?? Date.now();
    const deadlineStop = deadlineProblem(intent.deadline, this.options.quote, now);
    if (deadlineStop) throw new Error(deadlineStop);
    if (this.usedNonces.has(intent.nonce)) throw new Error("STOP: nonce");
    const shape = inspectIntent({ intents: intent.intents as unknown as IntentRecord[] }, this.options.quote);
    if (shape) throw new Error(shape);
    this.usedNonces.add(intent.nonce);
    if (this.inner) return this.inner.signIntent(intent);
    return this.signWebAuthn(intent);
  }

  private async signWebAuthn(intent: IntentPayload): Promise<Awaited<ReturnType<IIntentSigner["signIntent"]>>> {
    if (!this.options.publicKey) throw new Error("STOP: public key");
    const payload = this.options.payloadText?.() ?? defusePayload({
      signer_id: this.options.accountId,
      verifying_contract: intent.verifying_contract,
      deadline: intent.deadline,
      nonce: intent.nonce,
      intents: intent.intents,
    });
    const fields = webAuthnFields(payload);
    const signature = await this.signHash(Buffer.from(fields.messageHex, "hex"));
    return {
      standard: "webauthn",
      payload,
      public_key: this.options.publicKey,
      signature: `p256:${baseEncode(signature)}`,
      client_data_json: fields.clientDataJSON,
      authenticator_data: fields.authenticatorData,
    } as Awaited<ReturnType<IIntentSigner["signIntent"]>>;
  }

  /** The only call into bursar-signer. Guards run before this. */
  private signHash(hash: Uint8Array): Promise<Uint8Array> {
    if (this.options.signHash) return this.options.signHash(hash);
    return signWithHelper(this.options.accountId, hash);
  }
}

/** The enclave account. Creating the key can ask for Touch ID. The private key stays in the helper. */
export function enclaveIdentity(): Promise<{ accountId: string; publicKey: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperBinary(), ["account"], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8").trim().split("\n");
      if (code !== 0 || !text[0] || !text[1]) {
        reject(new Error(Buffer.concat(err).toString("utf8").trim() || "STOP: signer"));
        return;
      }
      resolve({ accountId: text[0], publicKey: text[1] });
    });
  });
}

/** The signed helper. The CLI sends the bytes to sign and reads a signature. */
export async function touchSigner(accountId: string, quote: SignedQuote, now?: () => number, payloadText?: () => string | undefined): Promise<BursarGuardedSigner> {
  if (/^[0-9a-f]{64}$/i.test(accountId)) {
    const { legacyInner } = await import("./legacy-key.js");
    return new BursarGuardedSigner(legacyInner(accountId), { accountId, quote, now });
  }
  const identity = await enclaveIdentity();
  if (identity.accountId !== accountId) throw new Error("STOP: signer id");
  return new BursarGuardedSigner(null, { accountId, publicKey: identity.publicKey, quote, now, payloadText });
}

/** NEAR native USDC. `ft_balance_of` is the on-chain balance, not the Intents balance. */
export const NEAR_USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** 30 TGas, the same budget as `report`. One yoctoNEAR is the NEP-141 transfer deposit. */
export const FT_TRANSFER_GAS = 30n * 10n ** 12n;

export type FtTransfer = {
  contractId: string;
  methodName: "ft_transfer";
  args: { receiver_id: string; amount: string; memo?: string };
  gas: bigint;
  attachedDeposit: bigint;
};

/** The one NEAR USDC transfer an MPP deposit is allowed to be. */
export function usdcTransfer(depositAddress: string, amount: string, memo: string | null): FtTransfer {
  const args: FtTransfer["args"] = { receiver_id: depositAddress, amount };
  if (memo) args.memo = memo;
  return {
    contractId: NEAR_USDC_CONTRACT,
    methodName: "ft_transfer",
    args,
    gas: FT_TRANSFER_GAS,
    attachedDeposit: 1n,
  };
}

/**
 * The ft_transfer half of the guarded signer. Anything other than one
 * `ft_transfer` of NEAR USDC, for this amount, to this deposit address, stops.
 * The secret is not an argument: the caller invokes the broadcaster only when this returns null.
 */
export function transferStop(
  action: FtTransfer,
  expected: { depositAddress: string; amount: string; memo: string | null },
): string | null {
  if (action.contractId !== NEAR_USDC_CONTRACT) return `STOP: token ${action.contractId}`;
  if (action.methodName !== "ft_transfer") return `STOP: method ${action.methodName}`;
  if (action.attachedDeposit !== 1n) return "STOP: deposit";
  if (action.gas !== FT_TRANSFER_GAS) return "STOP: gas";
  if (action.args.receiver_id !== expected.depositAddress) return `STOP: receiver_id ${action.args.receiver_id}`;
  if (action.args.amount !== expected.amount) return `STOP: token amount ${action.args.amount}`;
  const memo = action.args.memo ?? null;
  const wanted = expected.memo ?? null;
  if (memo !== wanted) return "STOP: memo";
  return null;
}

/**
 * Calls `broadcast` only after `transferStop` returns null.
 * `broadcast` does not receive the key.
 */
export async function signGuardedTransfer(
  action: FtTransfer,
  expected: { depositAddress: string; amount: string; memo: string | null },
  broadcast: () => Promise<string>,
): Promise<string> {
  const stop = transferStop(action, expected);
  if (stop) throw new Error(stop);
  return broadcast();
}

/**
 * Broadcasts the guarded NEAR USDC transfer. The helper signs only after
 * `transferStop` has accepted the action. The key stays in the helper.
 */
export async function sendGuardedUsdc(options: {
  accountId: string;
  depositAddress: string;
  amount: string;
  memo: string | null;
}): Promise<string> {
  const action = usdcTransfer(options.depositAddress, options.amount, options.memo);
  const stop = transferStop(action, options);
  if (stop) throw new Error(stop);
  throw new Error("STOP: the enclave key signs intents");
}

export function defusePayload(input: {
  signer_id: string;
  verifying_contract: string;
  deadline: string;
  nonce: string;
  intents: IntentPayload["intents"];
}): string {
  return JSON.stringify({
    signer_id: input.signer_id,
    verifying_contract: input.verifying_contract,
    deadline: input.deadline,
    nonce: input.nonce,
    intents: input.intents,
  });
}

/** Same bytes as `BursarEnclave.prepare`. The challenge is base64url(sha256(payload)). */
export function webAuthnFields(payload: string): { clientDataJSON: string; authenticatorData: string; messageHex: string } {
  const challenge = base64url(createHash("sha256").update(payload).digest());
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://app.bursar.phone"}`;
  const rp = createHash("sha256").update("app.bursar.phone").digest();
  const authenticator = Buffer.concat([rp, Buffer.from([0x05, 0, 0, 0, 0])]);
  const clientHash = createHash("sha256").update(clientDataJSON).digest();
  const message = Buffer.concat([authenticator, clientHash]);
  return {
    clientDataJSON,
    authenticatorData: base64url(authenticator),
    messageHex: message.toString("hex"),
  };
}

function base64url(data: Buffer): string {
  return data.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** sha256 of the NEP-413 borsh payload, the bytes Ed25519 signs. */
export function nep413Hash(input: { message: string; nonce: Uint8Array; recipient: string }): Uint8Array {
  if (input.nonce.length !== 32) throw new Error("STOP: nonce");
  const payload = Buffer.concat([
    borshString(input.message),
    Buffer.from(input.nonce),
    borshString(input.recipient),
    Buffer.from([0]),
  ]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE((2 ** 31 + 413) >>> 0);
  return createHash("sha256").update(prefix).update(payload).digest();
}

function borshString(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

function helperBinary(): string {
  return fileURLToPath(new URL("../signer/bursar-signer", import.meta.url));
}

function signWithHelper(accountId: string, message: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperBinary(), ["sign", accountId], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const signature = Buffer.concat(out);
      if (code !== 0 || signature.length !== 64) {
        reject(new Error(Buffer.concat(err).toString("utf8").trim() || "STOP: signer"));
        return;
      }
      resolve(signature);
    });
    child.stdin.end(message);
  });
}
