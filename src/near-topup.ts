import { fileURLToPath } from "node:url";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { NEAR_USDC } from "./assets.js";
import { intentsUsdc } from "./base-float.js";
import { referenceUi } from "./model.js";
import { signatureOk, type SignedQuote } from "./quote.js";

/** The enclave Intents account. USDC from this top-up is credited here. */
export const ENCLAVE_ACCOUNT = "0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b";

/** Native NEAR refunds go here. Not the enclave account. */
export const TOPUP_REFUND = "frsrcom.near";

/** 1Click's NEAR asset. An ORIGIN_CHAIN deposit of this asset is native NEAR. */
export const NEAR_ASSET = "nep141:wrap.near";

/** 0.1 NEAR, in yoctoNEAR. The test deposit. */
export const TEST_NEAR = 100000000000000000000000n;

const NEAR_DECIMALS = 24;

export function topupProblem(quote: SignedQuote, enclave = ENCLAVE_ACCOUNT, refundTo = TOPUP_REFUND): string | null {
  if (!signatureOk(quote)) return "STOP: bad signature";
  if (quote.quoteRequest.recipient !== enclave) return `STOP: recipient ${quote.quoteRequest.recipient}`;
  if (quote.quoteRequest.refundTo !== refundTo) return `STOP: refund ${quote.quoteRequest.refundTo}`;
  if (quote.quoteRequest.swapType !== "FLEX_INPUT") return "STOP: swap_type";
  if (quote.quoteRequest.depositType !== "ORIGIN_CHAIN") return "STOP: deposit_type";
  if (quote.quoteRequest.recipientType !== "INTENTS") return "STOP: recipient_type";
  if (quote.quoteRequest.refundType !== "ORIGIN_CHAIN") return "STOP: refund_type";
  if (quote.quoteRequest.originAsset !== NEAR_ASSET) return `STOP: origin ${quote.quoteRequest.originAsset}`;
  if (quote.quoteRequest.destinationAsset !== NEAR_USDC) return `STOP: asset ${quote.quoteRequest.destinationAsset}`;
  if (!quote.quote.depositAddress) return "STOP: deposit";
  if (!quote.quote.minAmountIn) return "STOP: minimum";
  if (!quote.quote.deadline) return "STOP: deadline";
  return null;
}

export function topupLines(quote: SignedQuote): string {
  const minimum = referenceUi(quote.quote.minAmountIn ?? "0", NEAR_DECIMALS);
  return [
    `deposit ${quote.quote.depositAddress}`,
    `minimum ${minimum} NEAR`,
    `expiry ${quote.quote.deadline}`,
  ].join("\n");
}

/** NEAR in, USDC out, credited to the enclave account. Refunds go to frsrcom.near. */
export async function quoteNearTopup(nearAtomic: bigint, nowMs = Date.now()): Promise<SignedQuote> {
  const deadline = new Date(nowMs + 30 * 60 * 1000).toISOString();
  return await OneClickService.getQuote({
    dry: false,
    swapType: "FLEX_INPUT",
    depositType: "ORIGIN_CHAIN",
    slippageTolerance: 100,
    originAsset: NEAR_ASSET,
    destinationAsset: NEAR_USDC,
    amount: nearAtomic.toString(),
    recipient: ENCLAVE_ACCOUNT,
    recipientType: "INTENTS",
    refundTo: TOPUP_REFUND,
    refundType: "ORIGIN_CHAIN",
    deadline,
  } as never) as SignedQuote;
}

export async function watchTopup(depositAddress: string, startedUsdc: bigint, expiryMs: number): Promise<string> {
  let status = "PENDING_DEPOSIT";
  while (Date.now() < expiryMs) {
    const balance = await intentsUsdc(ENCLAVE_ACCOUNT);
    if (balance > startedUsdc) return `arrived ${referenceUi(balance.toString(), 6)} USDC`;
    try {
      const body = await OneClickService.getExecutionStatus(depositAddress);
      status = body.status ?? status;
      if (status === "SUCCESS") {
        const after = await intentsUsdc(ENCLAVE_ACCOUNT);
        return `arrived ${referenceUi(after.toString(), 6)} USDC`;
      }
      if (status === "REFUNDED" || status === "FAILED") {
        const reason = body.swapDetails?.refundReason ?? "";
        return `STOP: ${status}${reason ? ` ${reason}` : ""}`;
      }
    } catch {
      status = "retry";
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  return `STOP: ${status}`;
}

/** NEAR input for a second quote, scaled from the test quote's USDC out. */
export function nearForUsdc(testNear: bigint, testUsdcOut: bigint, usdcNeeded: bigint): bigint {
  if (testUsdcOut <= 0n || usdcNeeded <= 0n) return 0n;
  const scaled = (testNear * usdcNeeded + testUsdcOut - 1n) / testUsdcOut;
  return scaled + scaled / 20n;
}

/** One USDC. A demo payment is at most this. The full top-up aims at this balance. */
const TARGET_USDC = 1_000_000n;

async function printQuote(nearAtomic: bigint, started: bigint): Promise<{ out: bigint; balance: bigint }> {
  const quote = await quoteNearTopup(nearAtomic);
  const problem = topupProblem(quote);
  if (problem) throw new Error(problem);
  const deposit = quote.quote.depositAddress ?? "";
  const expiry = Date.parse(quote.quote.deadline ?? "");
  process.stdout.write(topupLines(quote) + "\n");
  const arrived = await watchTopup(deposit, started, expiry);
  process.stdout.write(arrived + "\n");
  if (arrived.startsWith("STOP:")) throw new Error(arrived);
  const balance = await intentsUsdc(ENCLAVE_ACCOUNT);
  return { out: BigInt(quote.quote.minAmountOut), balance };
}

async function main(): Promise<void> {
  const balance = await intentsUsdc(ENCLAVE_ACCOUNT);
  process.stdout.write(`Intents ${referenceUi(balance.toString(), 6)} USDC\n`);
  if (balance >= TARGET_USDC) return;
  const short = TARGET_USDC - balance;
  process.stdout.write(`short ${referenceUi(short.toString(), 6)} USDC\n`);
  const watchAt = process.argv.indexOf("--watch");
  if (watchAt >= 0) {
    const deposit = process.argv[watchAt + 1] ?? "";
    const expiryArg = process.argv[process.argv.indexOf("--expiry") + 1] ?? "";
    const expiry = Date.parse(expiryArg);
    if (!deposit || Number.isNaN(expiry)) throw new Error("STOP: watch");
    const started = await intentsUsdc(ENCLAVE_ACCOUNT);
    const arrived = await watchTopup(deposit, started, expiry);
    process.stdout.write(arrived + "\n");
    if (arrived.startsWith("STOP:")) throw new Error(arrived);
    return;
  }
  if (process.argv.includes("--quote")) {
    const quote = await quoteNearTopup(TEST_NEAR);
    const problem = topupProblem(quote);
    if (problem) throw new Error(problem);
    process.stdout.write(topupLines(quote) + "\n");
    process.stdout.write(`minAmountOut ${quote.quote.minAmountOut}\n`);
    return;
  }
  const test = await printQuote(TEST_NEAR, balance);
  const still = TARGET_USDC > test.balance ? TARGET_USDC - test.balance : 0n;
  const full = nearForUsdc(TEST_NEAR, test.out, still);
  if (full === 0n) return;
  process.stdout.write(`full ${referenceUi(full.toString(), 24)} NEAR\n`);
  await printQuote(full, test.balance);
}

const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invoked) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + "\n");
    process.exit(1);
  });
}
