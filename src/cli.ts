import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { isNearAccount } from "./account.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, formatCheck, type ChainFacts } from "./decide.js";
import { loadFacts } from "./load.js";
import { plainAmounts } from "./model.js";
import { readPayeeMap } from "./payees.js";
import { settle } from "./pay.js";
import { reviewQuote, type BursarRequest, type SignedQuote } from "./quote.js";
import { signerFromSecret } from "./signer.js";

function emptyFacts(): ChainFacts {
  return { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };
}

export type Args = {
  receiver: string;
  amount?: string;
  token?: string;
  request?: string;
};

export class UsageError extends Error {}

function usage(): never {
  throw new UsageError(
    "bursar check <receiver> [--amount <amount>] [--token <token>] [--request <text>]\n"
    + "bursar pay --to <recipient> --amount <atomic> --origin <assetId> --dest <assetId> [--min-out <atomic>] [--fixture <quote.json>] [--request <text>]\n"
    + "bursar demo",
  );
}

export function parseArgs(argv: readonly string[]): Args {
  if (argv[0] !== "check" || !argv[1] || argv[1].startsWith("--")) usage();
  const args: Args = { receiver: argv[1] };
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !value || value.startsWith("--")) usage();
    if (flag === "--amount") args.amount = value;
    else if (flag === "--token") args.token = value;
    else if (flag === "--request") args.request = value;
    else usage();
  }
  return args;
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) usage();
  return value;
}

async function pay(argv: readonly string[]): Promise<void> {
  const to = flagValue(argv, "--to");
  const amount = flagValue(argv, "--amount");
  const origin = flagValue(argv, "--origin");
  const dest = flagValue(argv, "--dest");
  const minOut = flagValue(argv, "--min-out") ?? "0";
  const fixture = flagValue(argv, "--fixture");
  const requestText = flagValue(argv, "--request");
  if (!to || !amount || !origin || !dest) usage();
  const accountId = process.env.BURSAR_NEAR_ACCOUNT;
  const secret = process.env.BURSAR_NEAR_SECRET;
  if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
  const nowMs = Date.now();
  const request: BursarRequest = {
    recipient: to,
    refundTo: accountId,
    amount,
    originAsset: origin,
    destinationAsset: dest,
    deadline: new Date(nowMs + 4 * 60 * 1000).toISOString(),
    minAmountOut: minOut,
  };
  const response = fixture
    ? JSON.parse(readFileSync(fixture, "utf8")) as SignedQuote
    : await OneClickService.getQuote({
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "INTENTS",
      slippageTolerance: 100,
      originAsset: origin,
      destinationAsset: dest,
      amount,
      recipient: to,
      recipientType: isNearAccount(to) ? "INTENTS" : "DESTINATION_CHAIN",
      refundTo: accountId,
      refundType: "INTENTS",
      deadline: request.deadline,
    } as never) as SignedQuote;
  const nowSec = Math.floor(nowMs / 1000);
  const quoteStop = reviewQuote(response, request, nowSec);
  if (quoteStop) {
    process.stdout.write(quoteStop + "\n");
    return;
  }
  process.stdout.write(await plainAmounts(request, response.quote.minAmountOut) + "\n");
  const facts = isNearAccount(to) ? await loadFacts(to) : emptyFacts();
  const check = decide({
    receiver: to,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount,
    token: dest,
    request: requestText,
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(to),
  });
  process.stdout.write(formatCheck(check) + "\n");
  if (check.verdict !== "allow") {
    process.stdout.write("STOP\n");
    return;
  }
  if (fixture || !secret) {
    process.stdout.write("fixture replay: not submitted\n");
    return;
  }
  const signer = signerFromSecret(secret, accountId, response, () => nowMs);
  const line = await settle({
    quote: response,
    request,
    accountId,
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
  process.stdout.write(line + "\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "pay") {
    await pay(argv.slice(1));
    return;
  }
  if (argv[0] === "demo") {
    const { demoReport } = await import("./demo.js");
    const report = demoReport();
    process.stdout.write(report.text + "\n");
    process.exit(report.code);
  }
  const args = parseArgs(argv);
  const facts = isNearAccount(args.receiver) ? await loadFacts(args.receiver) : emptyFacts();
  const result = decide({
    receiver: args.receiver,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount: args.amount,
    token: args.token,
    request: args.request,
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(args.receiver),
  });
  process.stdout.write(formatCheck(result) + "\n");
}

const isDirect = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
