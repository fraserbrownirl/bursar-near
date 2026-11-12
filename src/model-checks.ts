import type { GeneratedIntent } from "./pay.js";
import { intentsDecText } from "./intents-dec.js";
import { liveCall, noteReferenceOnly } from "./model.js";
import { quoteCheckLine } from "./reference.js";
import type { BursarRequest, SignedQuote } from "./quote.js";

export type ModelCheck = { lines: string; stop: string | null; live: boolean };

function hexOf(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

/**
 * `1click check @quote` inside the model. The expected fields are the request,
 * not the quote's own copy of them. The TypeScript line is printed beside the
 * model's. They must match.
 */
export async function checkQuoteInModel(
  quote: SignedQuote,
  request: BursarRequest,
  nowSec: number,
): Promise<ModelCheck> {
  const memo = request.memo ?? "-";
  const cmd = [
    "1click check @quote",
    request.recipient,
    request.refundTo,
    request.destinationAsset,
    request.minAmountOut,
    request.amount,
    String(nowSec),
    memo,
  ].join(" ");
  const reference = quoteCheckLine(quote, request, nowSec);
  const live = await liveCall(cmd, { quote: hexOf(JSON.stringify(quote)) });
  return compare("1click check", cmd, live.value, reference, live.receipt);
}

/** `intents dec @payload` inside the model, beside the TypeScript decode. */
export async function checkIntentInModel(generated: GeneratedIntent, accountId: string): Promise<ModelCheck> {
  const message = JSON.parse(generated.intent.payload.message) as Record<string, unknown>;
  const payload = {
    signer_id: message.signer_id ?? accountId,
    verifying_contract: generated.intent.payload.recipient,
    deadline: message.deadline,
    nonce: generated.intent.payload.nonce,
    intents: message.intents,
  };
  const reference = intentsDecText(payload);
  const cmd = "intents dec @payload";
  const live = await liveCall(cmd, { payload: hexOf(JSON.stringify(payload)) });
  return compare(cmd, cmd, live.value, reference, live.receipt);
}

function compare(name: string, cmd: string, live: string | null, reference: string, receipt?: string): ModelCheck {
  const ref = reference.trim();
  if (live === null) {
    noteReferenceOnly();
    return {
      lines: [`${cmd} → ${ref} [reference (TypeScript)]`, "reference checks only"].join("\n"),
      stop: null,
      live: false,
    };
  }
  const lines = [
    `${cmd} → ${live.trim()} [live (model, Mac)]${receipt ? ` receipt ${receipt}` : ""}`,
    `reference (TypeScript) → ${ref}`,
  ];
  if (live.trim() !== ref) return { lines: lines.join("\n"), stop: `STOP: ${name}`, live: true };
  return { lines: lines.join("\n"), stop: null, live: true };
}
