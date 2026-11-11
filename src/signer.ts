import { execFileSync } from "node:child_process";
import { createIntentSignerNearKeyPair, type IIntentSigner, type IntentPayload } from "@defuse-protocol/intents-sdk";
import { connect, keyStores, KeyPair } from "near-api-js";
import { deadlineProblem } from "./deadline.js";
import { inspectIntent, type IntentRecord } from "./intent.js";
import type { SignedQuote } from "./quote.js";

export { deadlineProblem };

export class BursarGuardedSigner implements IIntentSigner {
  private readonly usedNonces = new Set<string>();

  constructor(
    private readonly inner: IIntentSigner,
    private readonly options: {
      accountId: string;
      quote: SignedQuote;
      now?: () => number;
    },
  ) {}

  /**
   * NEP-413 recipient is `verifying_contract` (intent-signer-nep413.js sets
   * `recipient: intent.verifying_contract`). The key is only on `inner`.
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
    const signed = await this.inner.signIntent(intent);
    this.usedNonces.add(intent.nonce);
    return signed;
  }
}

/** The signer key saved by `near account import-account … save-to-keychain`. */
export function secretFromKeychain(accountId: string): string {
  const raw = execFileSync("security", ["find-generic-password", "-s", `near-mainnet-${accountId}`, "-w"], {
    encoding: "utf8",
  }).trim();
  if (raw.startsWith("ed25519:") || raw.startsWith("secp256k1:")) return raw;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const secret = parsed.secret_keypair_str ?? parsed.private_key ?? parsed.secret_key;
  if (typeof secret !== "string" || secret.length === 0) throw new Error("keychain entry has no secret");
  return secret;
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
 * Signs the transfer only after `transferStop` returns null.
 * `broadcast` is the only function that receives the secret, and only then.
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

/** Receives the secret and passes it to the Intents keypair signer. */
export function signerFromSecret(secret: string, accountId: string, quote: SignedQuote, now?: () => number): BursarGuardedSigner {
  const inner = createIntentSignerNearKeyPair({
    signer: KeyPair.fromString(secret as never),
    accountId,
  });
  return new BursarGuardedSigner(inner, { accountId, quote, now });
}

/**
 * Broadcasts the guarded NEAR USDC transfer. The secret reaches `near-api-js`
 * only after `transferStop` has accepted the action.
 */
export async function sendGuardedUsdc(options: {
  secret: string;
  accountId: string;
  depositAddress: string;
  amount: string;
  memo: string | null;
}): Promise<string> {
  const action = usdcTransfer(options.depositAddress, options.amount, options.memo);
  return signGuardedTransfer(action, options, () => broadcastFtTransfer(action, options.accountId, options.secret));
}

async function broadcastFtTransfer(action: FtTransfer, accountId: string, secret: string): Promise<string> {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("mainnet", accountId, KeyPair.fromString(secret as `ed25519:${string}`));
  const near = await connect({
    networkId: "mainnet",
    nodeUrl: process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org",
    keyStore,
  } as never);
  const account = await near.account(accountId);
  const outcome = await account.functionCall({
    contractId: action.contractId,
    methodName: action.methodName,
    args: action.args,
    gas: action.gas,
    attachedDeposit: action.attachedDeposit,
  }) as { transaction: { hash: string } };
  return outcome.transaction.hash;
}
