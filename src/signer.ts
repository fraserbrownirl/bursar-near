import { createIntentSignerNearKeyPair, type IIntentSigner, type IntentPayload } from "@defuse-protocol/intents-sdk";
import { KeyPair } from "near-api-js";
import { inspectIntent, type IntentRecord } from "./intent.js";
import type { SignedQuote } from "./quote.js";

const HOURS_72_MS = 72 * 60 * 60 * 1000;

/** Intent deadline equals the signed quote deadline, that deadline is the request plus 72 hours, and it is still in the future. */
export function deadlineProblem(intentDeadline: string, quote: SignedQuote, now: number): string | null {
  const deadline = Date.parse(intentDeadline);
  const signed = Date.parse(quote.quote.deadline ?? "");
  const requested = Date.parse(quote.quoteRequest.deadline);
  if (Number.isNaN(deadline) || Number.isNaN(signed) || Number.isNaN(requested) || signed !== requested + HOURS_72_MS || deadline !== signed || deadline <= now) {
    return "STOP: deadline";
  }
  return null;
}

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

/** The only function that receives the secret and passes it to the keypair signer. */
export function signerFromSecret(secret: string, accountId: string, quote: SignedQuote, now?: () => number): BursarGuardedSigner {
  const inner = createIntentSignerNearKeyPair({
    signer: KeyPair.fromString(secret as never),
    accountId,
  });
  return new BursarGuardedSigner(inner, { accountId, quote, now });
}
