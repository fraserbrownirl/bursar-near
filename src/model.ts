import type { BursarRequest } from "./quote.js";

const MODEL_URL = process.env.BURSAR_MODEL_URL ?? "http://127.0.0.1:8000/v1/chat/completions";

export function decimalsOf(assetId: string): number {
  const id = assetId.toLowerCase();
  if (id.includes("usdc") || id.includes("usdt")) return 6;
  if (id.includes("dai")) return 18;
  return 24;
}

/** Integer atomic units to a decimal string. Same split a `sol ui` call returns. */
export function referenceUi(atomic: string, decimals: number): string {
  const value = BigInt(atomic);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

async function liveUi(cmd: string): Promise<string | null> {
  if (process.env.BURSAR_MODEL_URL === undefined && process.env.BURSAR_MODEL !== "1") return null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.BURSAR_MODEL_KEY) headers.authorization = `Bearer ${process.env.BURSAR_MODEL_KEY}`;
  try {
    const response = await fetch(MODEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "bursar-9b",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: "Call the eth tool once. Put this text in the cmd argument and do not change a character of it:\n" + cmd,
        }],
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: { message?: { reasoning_content?: string } }[] };
    const text = body.choices?.[0]?.message?.reasoning_content ?? "";
    const matched = text.match(/<tool_response>\n?([\s\S]*?)\n?<\/tool_response>/);
    return matched?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export async function showAmount(atomic: string, decimals: number): Promise<{ value: string; label: string; cmd: string }> {
  const cmd = `sol ui ${atomic} ${decimals}`;
  const live = await liveUi(cmd);
  if (live) return { value: live, label: "live (model, Mac)", cmd };
  return { value: referenceUi(atomic, decimals), label: "reference (TypeScript)", cmd };
}

export async function plainAmounts(request: Pick<BursarRequest, "amount" | "originAsset" | "destinationAsset" | "minAmountOut">, quotedMin: string): Promise<string> {
  const amount = await showAmount(request.amount, decimalsOf(request.originAsset));
  const minOut = await showAmount(quotedMin, decimalsOf(request.destinationAsset));
  return [
    `amountIn: ${amount.value} ← ${amount.cmd} [${amount.label}]`,
    `minAmountOut: ${minOut.value} ← ${minOut.cmd} [${minOut.label}]`,
    "1click check: not run",
  ].join("\n");
}
