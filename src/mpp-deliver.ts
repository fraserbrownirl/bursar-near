import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { NEAR_USDC } from "./assets.js";
import { floatAddress } from "./base-float.js";
import { loadBlocklist } from "./blocklist.js";
import { decide } from "./decide.js";
import { append } from "./guard/ledger.js";
import { referenceUi } from "./model.js";
import { checkQuoteInModel } from "./model-checks.js";
import { reviewMpp, type MppRequest } from "./mpp.js";
import { readPayeeMap } from "./payees.js";
import { settle } from "./pay.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { touchSigner } from "./signer.js";

/**
 * The quote Bursar asks 1Click for: exact output of the challenge amount,
 * from the Intents USDC balance, to the challenge deposit address.
 */
export function intentsDelivery(challenge: MppRequest, accountId: string, destinationAsset: string, deadline: string): BursarRequest {
  return {
    recipient: challenge.recipient,
    refundTo: accountId,
    amount: challenge.amount,
    originAsset: NEAR_USDC,
    destinationAsset,
    deadline,
    minAmountOut: challenge.amount,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
  };
}

/** 1Click asset id for a challenge currency, or null when that origin is not listed. */
export async function assetForCurrency(currency: string): Promise<string | null> {
  if (currency.startsWith("nep141:")) return currency;
  const reference = currency.slice(currency.lastIndexOf(":") + 1).toLowerCase();
  const tokens = await OneClickService.getTokens();
  const hit = tokens.find((token) => (token.contractAddress ?? "").toLowerCase() === reference);
  return hit?.assetId ?? null;
}

function refundAddress(request: MppRequest, accountId: string): string {
  const refund = request.methodDetails.refundTo;
  if (refund.startsWith("0x") || refund.startsWith("0X")) {
    const evm = floatAddress();
    if (!evm) throw new Error("STOP: refund address");
    return evm;
  }
  return accountId;
}

/**
 * Checks the merchant challenge, swaps from the Intents balance, and returns
 * the destination-chain deposit hash for the push credential.
 */
export async function deliverFromIntents(input: {
  accountId: string;
  request: MppRequest;
  expires?: string;
  merchantQuote: SignedQuote;
  nowMs?: number;
}): Promise<string> {
  const nowMs = input.nowMs ?? Date.now();
  const reviewed = reviewMpp({
    accountId: input.accountId,
    request: input.request,
    expires: input.expires,
    quote: input.merchantQuote,
    nowMs,
    expectRefund: refundAddress(input.request, input.accountId),
  });
  if (reviewed.stop) throw new Error(reviewed.stop);
  const destinationAsset = await assetForCurrency(input.request.currency);
  if (!destinationAsset) throw new Error("STOP: currency");
  const deadline = input.expires ?? new Date(nowMs + 4 * 60 * 1000).toISOString();
  const request = intentsDelivery(input.request, input.accountId, destinationAsset, deadline);
  const quote = await OneClickService.getQuote({
    dry: false,
    swapType: "EXACT_OUTPUT",
    depositType: "INTENTS",
    slippageTolerance: 100,
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    recipient: request.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: request.refundTo,
    refundType: "INTENTS",
    deadline: request.deadline,
  } as never) as SignedQuote;
  const nowSec = Math.floor(nowMs / 1000);
  const quoteStop = reviewQuote(quote, request, nowSec);
  if (quoteStop) throw new Error(quoteStop);
  const checked = await checkQuoteInModel(quote, request, nowSec);
  process.stdout.write(checked.lines + "\n");
  if (checked.stop) throw new Error(checked.stop);
  const receiver = input.request.methodDetails.destinationRecipient;
  const guard = decide({
    receiver,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount: input.request.amount,
    token: NEAR_USDC,
    request: "",
    facts: { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} },
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(receiver),
  });
  if (guard.verdict === "block") throw new Error(`STOP: ${guard.reasons[0] ?? "block"}`);
  const human = referenceUi(input.request.amount, 6);
  const card = `Pay ${human} USDC to ${input.request.methodDetails.destinationRecipient}?`;
  process.stdout.write((guard.reasons[0] ? `reason: ${guard.reasons[0]}\n` : "") + card + "\n");
  append("decision", { human: "yes", prompt: "pay url", reasons: guard.reasons, card });
  const deposit = quote.quote.depositAddress;
  if (!deposit) throw new Error("STOP: deposit");
  process.stdout.write(`amountIn: ${quote.quote.amountIn}\n`);
  const signer = await touchSigner(input.accountId, quote, () => nowMs);
  const settled = await settle({
    quote,
    request,
    accountId: input.accountId,
    nowSec,
    signer,
    generateIntent: async (depositAddress, signerId) => OneClickService.generateIntent({
      type: "swap_transfer",
      standard: "nep413",
      signerId,
      depositAddress,
    } as never) as Promise<{ intent: { payload: { message: string; nonce: string; recipient: string } } }>,
    submitIntent: async (signed) => OneClickService.submitIntent({ type: "swap_transfer", signedData: signed } as never),
  });
  if (settled !== "submitted") throw new Error(settled.startsWith("STOP") ? settled : `STOP: ${settled}`);
  const hash = await destinationHash(deposit);
  process.stdout.write(`deposit: ${hash}\n`);
  return hash;
}

async function destinationHash(depositAddress: string): Promise<string> {
  let status = "PENDING_DEPOSIT";
  for (let i = 0; i < 360; i += 1) {
    try {
      const body = await OneClickService.getExecutionStatus(depositAddress);
      status = body.status ?? status;
      const hash = body.swapDetails?.destinationChainTxHashes?.[0]?.hash;
      const reason = body.swapDetails?.refundReason ?? "";
      if (status === "SUCCESS" && hash) return hash;
      if (status === "REFUNDED" || status === "FAILED") throw new Error(`STOP: ${status}${reason ? ` ${reason}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("STOP:")) throw error;
      status = "retry";
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  throw new Error(`STOP: ${status}`);
}
