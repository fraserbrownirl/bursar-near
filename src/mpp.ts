import { referenceUi } from "./model.js";
import { injectionReason, scanForInstructions } from "./guard/injection.js";
import { normInt, signatureOk, type SignedQuote } from "./quote.js";

/** One USDC, in base units. A challenge `amount` above this stops. */
export const MPP_LIMIT_ATOMIC = "1000000";

/** NEAR native USDC as CAIP-19. The payer's origin asset. */
export const NEAR_USDC_CAIP = "near:mainnet/nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** USDC on Base as CAIP-19. The demo merchant's destination asset. */
export const BASE_USDC_CAIP = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** 0.25 USDC. The exact amount the demo merchant receives. */
export const MERCHANT_AMOUNT_OUT = "250000";

/** Header the payer sends so the merchant can put this account in `refundTo`. */
export const ACCOUNT_HEADER = "x-bursar-account";

/**
 * The decoded `nearintents` charge request. `recipient` is the 1Click deposit
 * address. The merchant's leg is in `methodDetails`.
 */
export type MppRequest = {
  amount: string;
  currency: string;
  recipient: string;
  description?: string;
  methodDetails: {
    originNetwork?: string;
    destinationAsset: string;
    destinationRecipient: string;
    amountOut: string;
    minAmountIn: string;
    refundTo: string;
    depositMemo?: string | null;
  };
};

export type MppReview = { stop: string | null; card: string };

/** The contract or address inside a 1Click asset id or a CAIP-19 id. */
function assetRef(id: string): string {
  const slash = id.lastIndexOf("/");
  const body = slash >= 0 ? id.slice(slash + 1) : id;
  const colon = body.indexOf(":");
  return colon >= 0 ? body.slice(colon + 1) : body;
}

/**
 * A 1Click asset id and a CAIP-19 id for the same asset.
 * NEAR: `nep141:<account>` and `near:mainnet/nep141:<account>`.
 * EVM: the 20-byte address appears in both, compared case-insensitively.
 */
export function assetsMatch(quoteAssetId: string, challengeAsset: string): boolean {
  if (quoteAssetId === challengeAsset) return true;
  const ref = assetRef(challengeAsset);
  if (quoteAssetId === ref || quoteAssetId === `nep141:${ref}`) return true;
  if (ref.startsWith("0x") && ref.length === 42 && quoteAssetId.toLowerCase().includes(ref.toLowerCase())) return true;
  return false;
}

function sameRefund(left: string, right: string): boolean {
  if (left.startsWith("0x") || left.startsWith("0X") || right.startsWith("0x") || right.startsWith("0X")) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function cardOf(request: MppRequest): string {
  const name = (request.description ?? "").trim() || request.methodDetails.destinationRecipient;
  return `Pay ${referenceUi(request.amount, 6)} USDC to ${name}?`;
}

/**
 * Fields of the signed quote that must equal the challenge.
 * `recipient` on the quote request is the merchant's destination account.
 */
function mismatched(quote: SignedQuote, request: MppRequest): string[] {
  const fails: string[] = [];
  const asked = quote.quoteRequest;
  const got = quote.quote;
  if (got.depositAddress !== request.recipient) fails.push("deposit");
  const amountOut = normInt(got.amountOut);
  const wantedOut = normInt(request.methodDetails.amountOut);
  if (amountOut === null || wantedOut === null || amountOut !== wantedOut) fails.push("amountOut");
  if (asked.recipient !== request.methodDetails.destinationRecipient) fails.push("destinationRecipient");
  if (!assetsMatch(asked.destinationAsset, request.methodDetails.destinationAsset)) fails.push("destinationAsset");
  if (asked.refundTo !== request.methodDetails.refundTo) fails.push("refundTo");
  const minIn = normInt(got.minAmountIn);
  const wantedMin = normInt(request.methodDetails.minAmountIn);
  if (minIn === null || wantedMin === null || minIn !== wantedMin) fails.push("minAmountIn");
  const amountIn = normInt(got.amountIn);
  const wantedIn = normInt(request.amount);
  if (amountIn === null || wantedIn === null || amountIn !== wantedIn) fails.push("amount");
  if (!assetsMatch(asked.originAsset, request.currency)) fails.push("origin");
  return fails;
}

/**
 * Stops before a deposit. Order: refund address, signed quote against the
 * challenge, expiry, description injection, then the amount cap.
 * A passing review still has the in-model check, `decide`, and the card ahead of it.
 */
export function reviewMpp(input: {
  accountId: string;
  request: MppRequest;
  expires?: string;
  quote: SignedQuote | null;
  nowMs: number;
  limitAtomic?: string;
  /** Address the deposit must refund to. Defaults to `accountId`. */
  expectRefund?: string;
}): MppReview {
  const card = cardOf(input.request);
  const expectRefund = input.expectRefund ?? input.accountId;
  if (!sameRefund(input.request.methodDetails.refundTo, expectRefund)) return { stop: "STOP: refund", card };
  if (!input.quote) return { stop: "STOP: quote", card };
  if (!signatureOk(input.quote)) return { stop: "STOP: bad signature", card };
  const fields = mismatched(input.quote, input.request);
  if (fields.length > 0) return { stop: `STOP: ${fields.join(" ")}`, card };
  const expiresMs = input.expires ? Date.parse(input.expires) : Number.NaN;
  if (!input.expires || Number.isNaN(expiresMs) || expiresMs <= input.nowMs) return { stop: "STOP: expired", card };
  const description = input.request.description ?? "";
  if (description.trim() !== "") {
    const findings = scanForInstructions([{ where: "description", text: description }]);
    if (findings.length > 0) return { stop: `STOP: ${injectionReason(findings)}`, card };
  }
  const amount = normInt(input.request.amount);
  const limit = normInt(input.limitAtomic ?? MPP_LIMIT_ATOMIC);
  if (amount === null || limit === null || BigInt(amount) > BigInt(limit)) return { stop: "STOP: limit", card };
  return { stop: null, card };
}
