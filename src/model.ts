import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BursarRequest } from "./quote.js";
import { receiptsDir, writeReceipt, type Receipt } from "./receipt.js";

const MODEL_URL = process.env.BURSAR_MODEL_URL ?? "http://127.0.0.1:8000/v1/chat/completions";

let referenceOnly = false;

/** A later in-model check failed. Cards stay labelled until one succeeds. */
export function noteReferenceOnly(): void {
  referenceOnly = true;
}

export function referenceChecksOnly(): boolean {
  return referenceOnly;
}

/** One tiny @file check. Failure is one line, and cards say reference checks only. */
export async function selfTestModel(): Promise<boolean> {
  const payload = JSON.stringify({
    signer_id: "a.near",
    verifying_contract: "intents.near",
    deadline: "2026-11-13T00:00:00.000Z",
    nonce: "11".repeat(32),
    intents: [],
  });
  const live = await liveCall("intents dec @payload", { payload: Buffer.from(payload, "utf8").toString("hex") }, { record: false });
  if (!live.value || !live.receipt) {
    referenceOnly = true;
    process.stderr.write("in-model check failed: reference checks only\n");
    return false;
  }
  referenceOnly = false;
  return true;
}

/** Integer atomic units to a decimal string. Same split a `sol ui` call returns. */
export function referenceUi(atomic: string, decimals: number): string {
  const value = BigInt(atomic);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

export type LiveCall = { value: string | null; receipt?: string };

/**
 * One in-weights call. `files` are the `@name` buffers, stored on the receipt
 * by SHA-256. A probe (`record: false`) never writes a receipt: the self-test
 * is not evidence, and an offline `npm test` must leave the tree untouched.
 */
export async function liveCall(cmd: string, files: Record<string, string> = {}, options: { record?: boolean } = {}): Promise<LiveCall> {
  const record = options.record !== false;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.BURSAR_MODEL_KEY) headers.authorization = `Bearer ${process.env.BURSAR_MODEL_KEY}`;
  const span = process.env.BURSAR_ATTACK_SPAN;
  const started = Date.now();
  const note = () => {
    if (!span) return;
    appendFileSync(span, `${JSON.stringify({ cmd, start: started, end: Date.now() })}\n`);
  };
  try {
    const response = await fetch(MODEL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "bursar-9b",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: "Call the eth tool once. Put this text in the cmd argument and do not change a character of it:\n" + cmd,
        }],
        ...(Object.keys(files).length > 0 ? { files } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      note();
      return { value: null };
    }
    const body = await response.json() as {
      choices?: { message?: { reasoning_content?: string } }[];
      computer?: {
        trace_tokens: number;
        trace_sha256: string;
        wall_ms: number | null;
        firmware_elf_sha256: string | null;
        chip_weights_sha256: string | null;
      }[];
    };
    const text = body.choices?.[0]?.message?.reasoning_content ?? "";
    const matched = text.match(/<tool_response>\n?([\s\S]*?)\n?<\/tool_response>/);
    const value = matched?.[1]?.trim() || null;
    const trace = body.computer?.[body.computer.length - 1];
    if (value && trace?.trace_sha256 && trace.firmware_elf_sha256 && trace.chip_weights_sha256 && record && process.env.BURSAR_RECORD_RECEIPTS !== "0") {
      const inputs: Record<string, string> = {};
      const inputDir = join(receiptsDir(), "inputs");
      if (Object.keys(files).length > 0) mkdirSync(inputDir, { recursive: true });
      for (const [name, text] of Object.entries(files)) {
        const digest = createHash("sha256").update(text).digest("hex");
        inputs[name] = digest;
        const path = join(inputDir, digest);
        if (!existsSync(path)) writeFileSync(path, text);
      }
      const receipt: Receipt = {
        cmd,
        inputs,
        firmware_elf_sha256: trace.firmware_elf_sha256,
        chip_weights_sha256: trace.chip_weights_sha256,
        output: value,
        trace_tokens: trace.trace_tokens,
        trace_sha256: trace.trace_sha256,
        wall_ms: trace.wall_ms ?? 0,
        runtime: "locals-mac",
        date: new Date().toISOString().slice(0, 10),
      };
      note();
      return { value, receipt: writeReceipt(receipt).hash };
    }
    note();
    return { value };
  } catch {
    note();
    return { value: null };
  }
}

export async function showAmount(atomic: string, decimals: number): Promise<{ value: string; label: string; cmd: string; receipt?: string }> {
  const cmd = `sol ui ${atomic} ${decimals}`;
  const live = await liveCall(cmd);
  if (live.value) return { value: live.value, label: "live (model, Mac)", cmd, receipt: live.receipt };
  return { value: referenceUi(atomic, decimals), label: "reference (TypeScript)", cmd };
}

export async function plainAmounts(
  request: Pick<BursarRequest, "amount" | "minAmountOut">,
  quotedMin: string,
  originDecimals: number,
  destDecimals: number,
): Promise<string> {
  const amount = await showAmount(request.amount, originDecimals);
  const minOut = await showAmount(quotedMin, destDecimals);
  const marked = (row: { cmd: string; value: string; label: string; receipt?: string }) =>
    `${row.cmd} → ${row.value} [${row.label}]${row.receipt ? ` receipt ${row.receipt}` : ""}`;
  return [
    `amountIn: ${marked(amount)}`,
    `minAmountOut: ${marked(minOut)}`,
  ].join("\n");
}
