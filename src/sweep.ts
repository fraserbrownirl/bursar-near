import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { intentsUsdc } from "./base-float.js";
import { NEAR_USDC } from "./assets.js";
import { checkIntentInModel, checkQuoteInModel } from "./model-checks.js";
import { settle } from "./pay.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { touchSigner } from "./signer.js";

/** The ed25519 account that still holds the Intents balance. */
export const LEGACY_ACCOUNT = "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54";

/**
 * Moves the Intents USDC balance to the Secure Enclave account, then deletes
 * the ed25519 keychain item. The two in-model checks run before the legacy key
 * signs. The key stays if the transfer does not land.
 */
export async function sweepAfterPremium(): Promise<string> {
  const { enclaveIdentity } = await import("./signer.js");
  const enclave = (await enclaveIdentity()).accountId;
  const amount = (await intentsUsdc(LEGACY_ACCOUNT)).toString();
  if (amount === "0") {
    await deleteLegacyKey();
    return `swept 0 to ${enclave}`;
  }
  const nowMs = Date.now();
  const request: BursarRequest = {
    recipient: enclave,
    refundTo: LEGACY_ACCOUNT,
    amount,
    originAsset: NEAR_USDC,
    destinationAsset: NEAR_USDC,
    deadline: new Date(nowMs + 4 * 60 * 1000).toISOString(),
    minAmountOut: "0",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
  };
  const response = await OneClickService.getQuote({
    dry: false,
    swapType: "EXACT_INPUT",
    depositType: "INTENTS",
    slippageTolerance: 100,
    originAsset: NEAR_USDC,
    destinationAsset: NEAR_USDC,
    amount,
    recipient: enclave,
    recipientType: "INTENTS",
    refundTo: LEGACY_ACCOUNT,
    refundType: "INTENTS",
    deadline: request.deadline,
  } as never) as SignedQuote;
  const nowSec = Math.floor(nowMs / 1000);
  const quoteStop = reviewQuote(response, request, nowSec);
  if (quoteStop) return quoteStop;
  const quoteCheck = await checkQuoteInModel(response, request, nowSec);
  process.stdout.write(quoteCheck.lines + "\n");
  if (quoteCheck.stop) return quoteCheck.stop;
  const deposit = response.quote.depositAddress;
  if (!deposit) return "STOP: deposit";
  const signer = await touchSigner(LEGACY_ACCOUNT, response, () => nowMs);
  const line = await settle({
    quote: response,
    request,
    accountId: LEGACY_ACCOUNT,
    nowSec,
    signer,
    checkIntent: (generated) => checkIntentInModel(generated, LEGACY_ACCOUNT).then((result) => {
      process.stdout.write(result.lines + "\n");
      return result.stop;
    }),
    generateIntent: async (depositAddress, signerId) => OneClickService.generateIntent({
      type: "swap_transfer",
      standard: "nep413",
      signerId,
      depositAddress,
    } as never) as Promise<{ intent: { payload: { message: string; nonce: string; recipient: string } } }>,
    submitIntent: async (signed) => OneClickService.submitIntent({ type: "swap_transfer", signedData: signed } as never),
  });
  if (line !== "submitted") return line;
  const landed = await destination(deposit);
  await deleteLegacyKey();
  return `swept ${amount} to ${enclave} ${landed}`;
}

async function destination(depositAddress: string): Promise<string> {
  let status = "PENDING_DEPOSIT";
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const body = await OneClickService.getExecutionStatus(depositAddress);
    status = body.status ?? status;
    const hash = body.swapDetails?.destinationChainTxHashes?.[0]?.hash;
    if (status === "SUCCESS" && hash) return `https://nearblocks.io/txns/${hash}`;
    if (status === "REFUNDED" || status === "FAILED") {
      throw new Error(`STOP: ${status}`);
    }
  }
  throw new Error(`STOP: ${status}`);
}

const exec = promisify(execFile);

function deleteLegacyKey(): Promise<void> {
  return exec("security", ["delete-generic-password", "-s", `near-mainnet-${LEGACY_ACCOUNT}`]).then(() => undefined);
}
