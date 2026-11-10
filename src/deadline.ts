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
