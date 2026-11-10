import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BursarRequest, SignedQuote } from "./quote.js";

const MODEL_URL = process.env.BURSAR_MODEL_URL;

/**
 * Ask Bursar-9B to run `1click check` when BURSAR_MODEL_URL is set.
 * Returns the tool result, or null when the model is not configured or does not answer.
 */
export async function live1click(response: SignedQuote, request: BursarRequest, nowSec: number): Promise<string | null> {
  if (!MODEL_URL) return null;
  const dir = mkdtempSync(join(tmpdir(), "bursar-quote-"));
  const file = join(dir, "quote.json");
  writeFileSync(file, JSON.stringify(response));
  const memo = request.memo ?? "-";
  const cmd = [
    "1click check",
    `@${file}`,
    request.recipient,
    request.refundTo,
    request.destinationAsset,
    request.minAmountOut,
    request.amount,
    String(nowSec),
    memo,
  ].join(" ");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.BURSAR_MODEL_KEY) headers.authorization = `Bearer ${process.env.BURSAR_MODEL_KEY}`;
  try {
    const res = await fetch(MODEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "bursar-9b",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: "Call the eth tool once. Put this text in the cmd argument and do not change a character of it:\n" + cmd,
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { choices?: { message?: { reasoning_content?: string } }[] };
    const text = body.choices?.[0]?.message?.reasoning_content ?? "";
    const matched = text.match(/<tool_response>\n?([\s\S]*?)\n?<\/tool_response>/);
    return matched?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}
