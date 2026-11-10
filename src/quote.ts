import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";

/**
 * 1Click's fee recipient. Observed on captured quotes on 2026-11-10
 * (`test/fixtures/quote-dry.json` and `quote-live.json`). The fee docs do not name it.
 */
export const ONECLICK_FEE_RECIPIENT = "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd";

const STABLES = ["usdc", "usdt", "dai"];

export type AppFee = { recipient: string; fee: number };

export type SignedQuote = {
  signature: string;
  timestamp: string;
  correlationId: string;
  quoteRequest: {
    dry?: boolean;
    recipient: string;
    refundTo: string;
    amount: string;
    originAsset: string;
    destinationAsset: string;
    deadline: string;
    depositType?: string;
    refundType?: string;
    swapType?: string;
    insured?: boolean;
    appFees?: AppFee[];
    customRecipientMsg?: string | null;
    virtualChainRecipient?: string | null;
    virtualChainRefundRecipient?: string | null;
  };
  quote: {
    depositAddress?: string;
    depositMemo?: string | null;
    amountIn: string;
    minAmountOut: string;
    deadline?: string;
  };
};

/** What Bursar asked 1Click for. Bursar does not set appFees. */
export type BursarRequest = {
  recipient: string;
  refundTo: string;
  amount: string;
  originAsset: string;
  destinationAsset: string;
  deadline: string;
  minAmountOut: string;
  memo?: string;
  insured?: boolean;
  hasJwt?: boolean;
};

export function normInt(value: string | undefined): string | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return value.replace(/^0+/, "") || "0";
}

function cmp(a: string, b: string): number {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function assetKind(id: string): string {
  const lower = id.toLowerCase();
  for (const name of STABLES) {
    if (lower.includes(name)) return name;
  }
  return lower;
}

/**
 * Documented cap, in basis points, for 1Click's own fee.
 * Without a JWT: 25. With a JWT: 20. Stablecoin pairs and same-asset transfers: 1.
 * Insured adds 2. https://docs.near-intents.org/resources/fees
 * Insured: QuoteRequest.insured, "an additional 0.02% (2 basis points)".
 */
export function feeCapBps(request: Pick<BursarRequest, "originAsset" | "destinationAsset" | "insured" | "hasJwt">): number {
  const left = assetKind(request.originAsset);
  const right = assetKind(request.destinationAsset);
  const cheap = left === right || (STABLES.includes(left) && STABLES.includes(right));
  let cap = cheap ? 1 : request.hasJwt ? 20 : 25;
  if (request.insured) cap += 2;
  return cap;
}

/** STOP naming the fee, or null when every entry is 1Click's observed recipient within the cap. */
export function feeStop(fees: readonly AppFee[] | undefined, cap: number): string | null {
  for (const fee of fees ?? []) {
    if (fee.recipient !== ONECLICK_FEE_RECIPIENT || fee.fee > cap) {
      return `STOP: app fee ${fee.fee} bps to ${fee.recipient}`;
    }
  }
  return null;
}

/**
 * TypeScript reference for `1click check`, plus originAsset and depositType,
 * which that command does not take as arguments.
 */
export function referenceCheck(response: SignedQuote, request: BursarRequest, nowSec: number): string[] {
  const fails: string[] = [];
  const asked = response.quoteRequest;
  const got = response.quote;
  if (asked.dry !== false) fails.push("dry");
  if (!got.depositAddress) fails.push("deposit");
  if (asked.depositType !== "INTENTS") fails.push("deposit_type");
  if (asked.refundType !== "INTENTS") fails.push("refund_type");
  for (const field of ["customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"] as const) {
    const value = asked[field];
    if (value != null && value !== "") fails.push(field);
  }
  if (asked.recipient !== request.recipient) fails.push("recipient");
  if (asked.refundTo !== request.refundTo) fails.push("refund");
  if (asked.destinationAsset !== request.destinationAsset) fails.push("asset");
  if (asked.originAsset !== request.originAsset) fails.push("origin");
  if (asked.deadline !== request.deadline) fails.push("request_deadline");
  const amount = normInt(got.amountIn);
  const wanted = normInt(request.amount);
  const signedAmount = normInt(asked.amount);
  if (amount === null || wanted === null || cmp(amount, wanted) !== 0) fails.push("amount");
  if ((asked.swapType ?? "EXACT_INPUT") === "EXACT_INPUT" && (amount === null || signedAmount === null || cmp(amount, signedAmount) !== 0)) {
    if (!fails.includes("amount")) fails.push("amount");
  }
  const minOut = normInt(got.minAmountOut);
  const minWanted = normInt(request.minAmountOut);
  if (minOut === null || minWanted === null || cmp(minOut, minWanted) < 0) fails.push("min_out");
  const memo = got.depositMemo;
  if (memo == null || memo === "") {
    if (request.memo) fails.push("memo");
  } else if (memo !== request.memo) {
    fails.push("memo");
  }
  const deadlineMs = got.deadline ? Date.parse(got.deadline) : Number.NaN;
  if (!got.deadline || Number.isNaN(deadlineMs) || Math.floor(deadlineMs / 1000) <= nowSec) fails.push("deadline");
  return fails;
}

export function signatureOk(response: SignedQuote): boolean {
  try {
    return verifyQuoteSignature(response as never);
  } catch {
    return false;
  }
}

/** The account `bursar check` runs on. The deposit address is not the payee. */
export function payeeOf(response: SignedQuote): string {
  return response.quoteRequest.recipient;
}

export function requestFromQuote(response: SignedQuote): BursarRequest {
  return {
    recipient: response.quoteRequest.recipient,
    refundTo: response.quoteRequest.refundTo,
    amount: response.quoteRequest.amount,
    originAsset: response.quoteRequest.originAsset,
    destinationAsset: response.quoteRequest.destinationAsset,
    deadline: response.quoteRequest.deadline,
    minAmountOut: response.quote.minAmountOut,
    memo: response.quote.depositMemo || undefined,
    insured: response.quoteRequest.insured,
  };
}

/**
 * Signature, then the field comparison, then the fee cap.
 * Returns a STOP line, or null when the quote may proceed to `bursar check`.
 */
export function reviewQuote(response: SignedQuote, request: BursarRequest, nowSec: number): string | null {
  const fee = feeStop(response.quoteRequest.appFees, feeCapBps(request));
  if (fee) return fee;
  if (!signatureOk(response)) return "STOP: bad signature";
  const fails = referenceCheck(response, request, nowSec);
  if (fails.length > 0) return `STOP: ${fails.join(" ")}`;
  return null;
}
