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
 * What the caller states to `1click check`: the deposit amount on the signed
 * quote, and the smallest output the caller accepts. The in-model computer
 * compares the quote's `amountIn` with the stated amount whatever the swap
 * type, so an EXACT_OUTPUT quote is stated as its `amountIn`, with the exact
 * output it must deliver as `minAmountOut`. `reviewQuote` runs on the request
 * itself before this; a quote without an `amountIn` never gets here.
 */
export function statedRequest(quote: SignedQuote, request: BursarRequest): BursarRequest {
  const amount = quote.quote.amountIn;
  if (!/^\d+$/.test(amount)) return request;
  const exactOut = (request.swapType ?? "EXACT_INPUT") === "EXACT_OUTPUT";
  return { ...request, amount, minAmountOut: exactOut ? request.amount : request.minAmountOut };
}

/**
 * `1click check @quote` inside the model. The expected fields are the request,
 * restated as the deposit the quote names, not the quote's own copy of them.
 * The TypeScript line is printed beside the model's. They must match.
 */
export async function checkQuoteInModel(
  quote: SignedQuote,
  request: BursarRequest,
  nowSec: number,
): Promise<ModelCheck> {
  const stated = statedRequest(quote, request);
  const memo = stated.memo ?? "-";
  const cmd = [
    "1click check @quote",
    stated.recipient,
    stated.refundTo,
    stated.destinationAsset,
    stated.minAmountOut,
    stated.amount,
    String(nowSec),
    memo,
  ].join(" ");
  const reference = quoteCheckLine(quote, stated, nowSec);
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

/** A payment stops unless the model ran the check and wrote a receipt. */
export function requireLive(check: ModelCheck): string | null {
  if (check.stop) return check.stop;
  if (!check.live || !/receipt [0-9a-f]{64}/.test(check.lines)) return "STOP: in-model check";
  return null;
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
