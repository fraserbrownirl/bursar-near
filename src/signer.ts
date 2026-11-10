import { execFileSync } from "node:child_process";
import { createIntentSignerNearKeyPair, type IIntentSigner, type IntentPayload } from "@defuse-protocol/intents-sdk";
import { KeyPair } from "near-api-js";
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

/** The only function that receives the secret and passes it to the keypair signer. */
export function signerFromSecret(secret: string, accountId: string, quote: SignedQuote, now?: () => number): BursarGuardedSigner {
  const inner = createIntentSignerNearKeyPair({
    signer: KeyPair.fromString(secret as never),
    accountId,
  });
  return new BursarGuardedSigner(inner, { accountId, quote, now });
}
