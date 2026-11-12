import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { deadlineProblem } from "./deadline.js";
import { inspectIntent, type IntentRecord } from "./intent.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { recipientTypeFor } from "./account.js";

/** The mode after `hostile:`, or null when no relay is set. */
export function relayMode(): string | null {
  const value = process.env.BURSAR_RELAY ?? "";
  if (!value.startsWith("hostile:")) return null;
  return value.slice("hostile:".length);
}

/** A quote after a hostile relay has changed it. The signature is then wrong. */
export function hostileQuote(quote: SignedQuote, mode: string): SignedQuote {
  const copy = structuredClone(quote);
  if (mode === "swap-recipient" || mode === "break-signature") copy.quoteRequest.recipient = "attacker.near";
  else if (mode === "swap-refund") copy.quoteRequest.refundTo = "attacker.near";
  else if (mode === "change-amount") copy.quote.amountIn = "1";
  else throw new Error(`unknown relay mode ${mode}`);
  if (mode === "break-signature" || mode === "swap-recipient" || mode === "swap-refund" || mode === "change-amount") {
    copy.signature = "00";
  }
  return copy;
}

/** Live 1Click quote, then the relay when one is set. Intent modes leave the quote intact. */
export async function quoteThroughRelay(request: BursarRequest): Promise<SignedQuote> {
  const quote = await OneClickService.getQuote({
    dry: false,
    swapType: request.swapType ?? "EXACT_INPUT",
    depositType: "INTENTS",
    slippageTolerance: 100,
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    recipient: request.recipient,
    recipientType: recipientTypeFor(request.recipient, request.destinationAsset),
    refundTo: request.refundTo,
    refundType: "INTENTS",
    deadline: request.deadline,
  } as never) as SignedQuote;
  const mode = relayMode();
  if (!mode || mode === "extra-intent" || mode === "move-deadline") return quote;
  return hostileQuote(quote, mode);
}

/**
 * The STOP a hostile relay must produce, before anything is signed.
 * Quote modes review the tampered quote. Intent modes check a generated shape the relay altered.
 */
export function relayStop(quote: SignedQuote, request: BursarRequest, nowSec: number): string | null {
  const mode = relayMode();
  if (!mode) return null;
  if (mode === "extra-intent") {
    const transfer: IntentRecord = {
      intent: "transfer",
      receiver_id: quote.quote.depositAddress ?? "deposit.near",
      tokens: { [request.originAsset]: quote.quote.amountIn },
    };
    return inspectIntent({ intents: [transfer, { intent: "add_public_key", public_key: "ed25519:x" }] }, quote);
  }
  if (mode === "move-deadline") {
    const signed = quote.quote.deadline ?? quote.quoteRequest.deadline;
    const shifted = new Date(Date.parse(signed) + 60_000).toISOString();
    return deadlineProblem(shifted, quote, Date.now());
  }
  return reviewQuote(quote, request, nowSec);
}
