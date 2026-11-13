import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { isNearAccount } from "./account.js";
import { NEAR_USDC } from "./assets.js";
import { floatAddress } from "./base-float.js";
import { loadBlocklist } from "./blocklist.js";
import { decide } from "./decide.js";
import { loadFacts } from "./load.js";
import { append } from "./guard/ledger.js";
import { terminalWidth, wrapWords } from "./guard/reason.js";
import { referenceUi } from "./model.js";
import { checkIntentInModel, checkQuoteInModel, requireLive } from "./model-checks.js";
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

/** The check line for the owner: what was checked, the verdict, who computed it, and the receipt. The full command prints under BURSAR_VERBOSE. */
function showCheck(checked: { lines: string; value?: string | null; reference?: string }, what: string): void {
  if (process.env.BURSAR_VERBOSE === "1") {
    process.stdout.write(checked.lines + "\n");
    return;
  }
  const receipt = checked.lines.match(/receipt ([0-9a-f]{64})/)?.[1]?.slice(0, 12);
  const value = checked.value ?? "";
  const agreed = value !== "" && value === checked.reference;
  process.stdout.write(`${what} → ${agreed ? "ok" : value} [live (model, Mac)]${receipt ? ` receipt ${receipt}…` : ""}\n`);
  process.stdout.write(agreed ? "The TypeScript reference agrees → ok\n" : `The TypeScript reference says → ${checked.reference ?? ""}\n`);
}

/** The destination-chain explorer for the delivery hash. */
function deliveryLink(originNetwork: string | undefined, hash: string): string {
  const root: Record<string, string> = {
    "eip155:1": "https://etherscan.io/tx/",
    "eip155:8453": "https://basescan.org/tx/",
    "eip155:42161": "https://arbiscan.io/tx/",
    "sol:mainnet": "https://solscan.io/tx/",
    "btc:mainnet": "https://mempool.space/tx/",
    "near:mainnet": "https://nearblocks.io/txns/",
  };
  const base = originNetwork ? root[originNetwork] : undefined;
  return base ? `${base}${hash}` : hash;
}
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
  showCheck(checked, "Checking the quote inside the model");
  const quoteLive = requireLive(checked);
  if (quoteLive) throw new Error(quoteLive);
  const receiver = input.request.methodDetails.destinationRecipient;
  const facts = isNearAccount(receiver) ? await loadFacts(receiver) : { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };
  const guard = decide({
    receiver,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount: input.request.amount,
    token: NEAR_USDC,
    request: "",
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(receiver),
  });
  if (guard.verdict === "block") throw new Error(`STOP: ${guard.reasons[0] ?? "block"}`);
  const spend = referenceUi(quote.quote.amountIn, 6);
  const price = referenceUi(input.request.methodDetails.amountOut, 6);
  const delivered = referenceUi(input.request.amount, 6);
  const chain = chainName(input.request.methodDetails.originNetwork);
  const recipient = input.request.methodDetails.destinationRecipient;
  const card = [
    `1. The page's price is ${price} USDC to ${recipient}, collected through a one-time NEAR Intents deposit address on ${chain}.`,
    `2. Bursar sends ${delivered} USDC to that address from its NEAR Intents balance (cost ${spend} with fees).`,
    `3. NEAR Intents pays ${price} USDC to ${recipient} on NEAR.`,
  ].join("\n");
  const reason = guard.reasons[0];
  if (reason) process.stdout.write(`note: ${reason === "account code hash unavailable" ? "the account's code could not be read on-chain" : reason}\n`);
  const width = Math.min(terminalWidth(), 100) - 3;
  const wrapped = card.split("\n").map((line) => wrapWords(line, width).split("\n").join("\n   ")).join("\n");
  process.stdout.write(wrapped + "\n");
  append("decision", { human: "yes", prompt: "pay url", reasons: guard.reasons, card });
  const deposit = quote.quote.depositAddress;
  if (!deposit) throw new Error("STOP: deposit");
  const exactPayload = { text: "" };
  const { generateSwapIntent } = await import("./swap-intent.js");
  const signer = await touchSigner(input.accountId, quote, () => nowMs, () => exactPayload.text || undefined);
  const settled = await settle({
    quote,
    request,
    accountId: input.accountId,
    nowSec,
    signer,
    checkIntent: async (generated) => {
      const decoded = await checkIntentInModel(generated, input.accountId);
      showCheck(decoded, `Decoding the intent inside the model: one transfer of ${spend} USDC to the signed quote's deposit address`);
      return requireLive(decoded);
    },
    generateIntent: (depositAddress, signerId) => generateSwapIntent(depositAddress, signerId, exactPayload),
    submitIntent: async (signed) => OneClickService.submitIntent({ type: "swap_transfer", signedData: signed } as never),
  });
  if (settled !== "submitted") throw new Error(settled.startsWith("STOP") ? settled : `STOP: ${settled}`);
  const approved = process.env.BURSAR_SIGNING_BYPASS === "1" ? "Signed without Touch ID (bypass set)" : "Approved with Touch ID";
  process.stdout.write(`${approved}. Waiting for the money to arrive…\n`);
  const hash = await destinationHash(deposit);
  process.stdout.write(`Delivered: ${deliveryLink(input.request.methodDetails.originNetwork, hash)}\n`);
  return hash;
}

function chainName(originNetwork: string | undefined): string {
  const names: Record<string, string> = {
    "eip155:1": "Ethereum",
    "eip155:8453": "Base",
    "eip155:42161": "Arbitrum",
    "sol:mainnet": "Solana",
    "btc:mainnet": "Bitcoin",
    "near:mainnet": "NEAR",
  };
  return originNetwork ? (names[originNetwork] ?? originNetwork) : "NEAR";
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
