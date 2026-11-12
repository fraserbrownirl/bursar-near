import { readFileSync } from "node:fs";
import { referenceUi } from "./model.js";
import { intentsDecText } from "./intents-dec.js";
import { normInt, signatureOk, type SignedQuote } from "./quote.js";

export { referenceUi };

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

type Nep413Hash = (payload: {
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callback_url: null;
}) => Promise<Uint8Array>;

/** The SDK's hash, loaded from its file. The package export map does not expose it. */
async function sdkNep413(): Promise<Nep413Hash> {
  const url = new URL("../node_modules/@defuse-protocol/intents-sdk/dist/src/lib/nep413.js", import.meta.url);
  const mod = await import(url.href) as { hashNEP413Message: Nep413Hash };
  return mod.hashNEP413Message;
}

/** NEP-413 message hash, lowercase hex. Nonce is 32 bytes. */
export async function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Promise<string> {
  if (nonce.length !== 32) throw new Error("STOP: nonce");
  const hashNEP413Message = await sdkNep413();
  const digest = await hashNEP413Message({ message, recipient, nonce, callback_url: null });
  return hex(digest);
}

function parseNonce(text: string): Uint8Array {
  const hexText = text.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hexText)) throw new Error("STOP: nonce");
  return Buffer.from(hexText, "hex");
}

/**
 * The firmware's `1click check` line, plus the signature.
 * The expected recipient, refund, asset, amount, min-out, and memo are the
 * caller's. They are not read back out of the quote.
 * `ok`, or `fail` plus the firmware's words. A bad signature is `fail signature`
 * and nothing else: the firmware does not check the signature.
 */
export function quoteCheckLine(quote: SignedQuote, expected: {
  recipient: string;
  refundTo: string;
  destinationAsset: string;
  amount: string;
  minAmountOut: string;
  memo?: string;
}, nowSec: number): string {
  if (!signatureOk(quote)) return "fail signature";
  return quoteFieldLine(quote, expected, nowSec);
}

/**
 * The field half of `1click check`. Recipient and refund are compared as
 * text, so an ed25519 implicit account and a `0x` P-256 implicit account
 * are the same rule. The signature is not checked here.
 */
export function quoteFieldLine(quote: SignedQuote, expected: {
  recipient: string;
  refundTo: string;
  destinationAsset: string;
  amount: string;
  minAmountOut: string;
  memo?: string;
}, nowSec: number): string {
  const asked = quote.quoteRequest;
  const got = quote.quote;
  const fails: string[] = [];
  if (asked.dry !== false) fails.push("dry");
  if (!got.depositAddress) fails.push("deposit");
  if (asked.recipient !== expected.recipient) fails.push("recipient");
  if (asked.refundTo !== expected.refundTo) fails.push("refund");
  if (asked.destinationAsset !== expected.destinationAsset) fails.push("asset");
  const amount = normInt(got.amountIn);
  const wanted = normInt(expected.amount);
  const signedAmount = normInt(asked.amount);
  const swap = asked.swapType ?? "EXACT_INPUT";
  const amountFail = swap === "EXACT_INPUT"
    ? amount === null || wanted === null || amount !== wanted
    : signedAmount === null || wanted === null || signedAmount !== wanted;
  if (amountFail) fails.push("amount");
  const minOut = normInt(got.minAmountOut);
  const minWanted = normInt(expected.minAmountOut);
  if (minOut === null || minWanted === null || cmp(minOut, minWanted) < 0) fails.push("min_out");
  const memo = got.depositMemo;
  const wantedMemo = expected.memo ?? "";
  if (memo == null || memo === "") {
    if (wantedMemo !== "") fails.push("memo");
  } else if (memo !== wantedMemo) fails.push("memo");
  const deadlineMs = got.deadline ? Date.parse(got.deadline) : Number.NaN;
  if (!got.deadline || Number.isNaN(deadlineMs) || Math.floor(deadlineMs / 1000) <= nowSec) fails.push("deadline");
  return fails.length === 0 ? "ok" : `fail ${fails.join(" ")}`;
}

/**
 * `1click check` against verifyQuoteSignature and the field rules.
 * The quote is a file named in `files` (`@name` or the bare name).
 * Recipient and refund are the same: a literal account, or `@name` whose
 * file is the account text (a spilled `0x` implicit account).
 */
function accountArg(token: string, files: Readonly<Record<string, Buffer>>): string | null {
  if (!token.startsWith("@")) return token;
  const bytes = files[token.slice(1)];
  return bytes ? bytes.toString("utf8") : null;
}

export function reference1Click(args: readonly string[], files: Readonly<Record<string, Buffer>>): string {
  if (args.length !== 9 || args[0] !== "check") return "error (bad op)";
  const [, quoteArg, recipientTok, refundTok, asset, minOut, amount, nowText, memoTok] = args;
  if (!/^\d+$/.test(nowText)) return "error (bad now)";
  const recipient = accountArg(recipientTok, files);
  const refundTo = accountArg(refundTok, files);
  if (recipient === null || refundTo === null) return "error (no file)";
  const name = quoteArg.startsWith("@") ? quoteArg.slice(1) : quoteArg;
  const bytes = files[name];
  if (!bytes) return "error (no file)";
  let quote: SignedQuote;
  try {
    const text = bytes.toString("utf8");
    const json = text.startsWith("{") ? text : Buffer.from(text.replace(/^0x/i, ""), "hex").toString("utf8");
    quote = JSON.parse(json) as SignedQuote;
  } catch {
    return "error (bad json)";
  }
  return quoteCheckLine(quote, {
    recipient,
    refundTo,
    destinationAsset: asset,
    amount,
    minAmountOut: minOut,
    memo: memoTok === "-" ? undefined : memoTok,
  }, Number(nowText));
}

function cmp(a: string, b: string): number {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

export async function referenceCommand(cmd: string, files: Readonly<Record<string, Buffer>> = {}): Promise<string> {
  const ui = cmd.match(/^(?:sol\s+)?ui\s+(\d+)\s+(\d+)$/);
  if (ui) return referenceUi(ui[1], Number(ui[2]));
  if (cmd.startsWith("nep413 ")) {
    const rest = cmd.slice("nep413 ".length);
    const recipient = rest.split(" ")[0];
    const nonceText = rest.split(" ")[1];
    const message = rest.slice(recipient.length + nonceText.length + 2);
    return nep413Hash(message, parseNonce(nonceText), recipient);
  }
  if (cmd.startsWith("1click ")) return reference1Click(cmd.slice("1click ".length).split(/\s+/), files);
  if (cmd === "intents dec @payload") {
    const bytes = files.payload;
    if (!bytes) return "error (no file)";
    const text = bytes.toString("utf8");
    const json = text.startsWith("{") ? text : Buffer.from(text.replace(/^0x/i, ""), "hex").toString("utf8");
    return intentsDecText(JSON.parse(json) as Parameters<typeof intentsDecText>[0]);
  }
  throw new Error(`no reference for ${cmd}`);
}

export function loadInputFiles(inputs: Readonly<Record<string, string>>, dir: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const name of Object.keys(inputs)) {
    files[name] = readFileSync(`${dir}/${name}`);
  }
  return files;
}
