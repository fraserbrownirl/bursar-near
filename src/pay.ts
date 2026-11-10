import type { IIntentSigner, IntentPayload } from "@defuse-protocol/intents-sdk";
import { inspectIntent } from "./intent.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";

export type GeneratedIntent = {
  intent: {
    payload: {
      message: string;
      nonce: string;
      recipient: string;
    };
  };
};

/**
 * Quote checks, then generateIntent, then the one-shape rule, then the guarded signer.
 * submitIntent runs only after signIntent returns. This function does not hold a key.
 */
export async function settle(options: {
  quote: SignedQuote;
  request: BursarRequest;
  accountId: string;
  nowSec: number;
  signer: IIntentSigner;
  generateIntent: (depositAddress: string, signerId: string) => Promise<GeneratedIntent>;
  /** Runs `intents dec` in the model. A string result is a STOP line. */
  checkIntent?: (generated: GeneratedIntent) => Promise<string | null>;
  submitIntent?: (signed: Awaited<ReturnType<IIntentSigner["signIntent"]>>) => Promise<unknown>;
}): Promise<string> {
  if (options.request.refundTo !== options.accountId) return "STOP: refund";
  const quoteStop = reviewQuote(options.quote, options.request, options.nowSec);
  if (quoteStop) return quoteStop;
  const deposit = options.quote.quote.depositAddress;
  if (!deposit) return "STOP: deposit";
  const generated = await options.generateIntent(deposit, options.accountId);
  if (options.checkIntent) {
    const intentStop = await options.checkIntent(generated);
    if (intentStop) return intentStop;
  }
  const message = JSON.parse(generated.intent.payload.message) as {
    deadline: string;
    signer_id: string;
    intents: IntentPayload["intents"];
  };
  const shape = inspectIntent({ intents: message.intents as never }, options.quote);
  if (shape) return shape;
  try {
    const signed = await options.signer.signIntent({
      verifying_contract: generated.intent.payload.recipient,
      deadline: message.deadline,
      nonce: generated.intent.payload.nonce,
      signer_id: message.signer_id,
      intents: message.intents,
    });
    if (!options.submitIntent) return "STOP: not submitted";
    await options.submitIntent(signed);
    return "submitted";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
