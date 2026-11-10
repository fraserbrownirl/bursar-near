import { createIntentSignerNearKeyPair, type IIntentSigner, type IntentPayload } from "@defuse-protocol/intents-sdk";
import { KeyPair } from "near-api-js";
import { inspectIntent, type IntentRecord } from "./intent.js";
import type { SignedQuote } from "./quote.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

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
    const deadline = Date.parse(intent.deadline);
    if (Number.isNaN(deadline) || deadline <= now || deadline > now + FIVE_MINUTES_MS) {
      throw new Error("STOP: deadline");
    }
    if (this.usedNonces.has(intent.nonce)) throw new Error("STOP: nonce");
    const shape = inspectIntent({ intents: intent.intents as unknown as IntentRecord[] }, this.options.quote);
    if (shape) throw new Error(shape);
    const signed = await this.inner.signIntent(intent);
    this.usedNonces.add(intent.nonce);
    return signed;
  }
}

/** The only function that receives the secret and passes it to the keypair signer. */
export function signerFromSecret(secret: string, accountId: string, quote: SignedQuote, now?: () => number): BursarGuardedSigner {
  const inner = createIntentSignerNearKeyPair({
    signer: KeyPair.fromString(secret as never),
    accountId,
  });
  return new BursarGuardedSigner(inner, { accountId, quote, now });
}
