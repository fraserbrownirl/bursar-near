import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isNearAccount } from "./account.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, formatCheck, type ChainFacts } from "./decide.js";
import { expectedTransfer, inspectIntent } from "./intent.js";
import { loadFacts } from "./load.js";
import { live1click } from "./model.js";
import { readPayeeMap } from "./payees.js";
import { feeCapBps, feeStop, payeeOf, referenceCheck, requestFromQuote, signatureOk, type SignedQuote } from "./quote.js";

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
    + "bursar pay --fixture <quote.json> [--request <text>]\n"
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

async function pay(argv: readonly string[]): Promise<void> {
  let fixture = "";
  let requestText: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || !value || value.startsWith("--")) usage();
    if (flag === "--fixture") fixture = value;
    else if (flag === "--request") requestText = value;
    else usage();
  }
  if (!fixture) usage();
  const response = JSON.parse(readFileSync(fixture, "utf8")) as SignedQuote;
  const nowSec = Math.floor(Date.now() / 1000);
  const asked = requestFromQuote(response);
  const fee = feeStop(response.quoteRequest.appFees, feeCapBps(asked));
  if (fee) {
    process.stdout.write(fee + "\n");
    return;
  }
  if (!signatureOk(response)) {
    process.stdout.write("STOP: bad signature\n");
    return;
  }
  const live = await live1click(response, asked, nowSec);
  const label = live ? "live (model, Mac)" : "reference (TypeScript)";
  const fails = live
    ? (live.startsWith("ok") ? [] : [live.replace(/^fail\s*/, "").trim()])
    : referenceCheck(response, asked, nowSec);
  if (asked.originAsset !== response.quoteRequest.originAsset) fails.push("origin");
  if (fails.length > 0) {
    process.stdout.write(`STOP: ${fails.join(" ")}\n${label}\n`);
    return;
  }
  const receiver = payeeOf(response);
  process.stdout.write(`receiver: ${receiver}\n`);
  const facts = isNearAccount(receiver) ? await loadFacts(receiver) : emptyFacts();
  const check = decide({
    receiver,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    request: requestText,
    facts,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(receiver),
  });
  process.stdout.write(formatCheck(check) + "\n");
  if (check.verdict !== "allow") return;
  const shape = inspectIntent({ intents: [expectedTransfer(response)] }, response);
  if (shape) {
    process.stdout.write(shape + "\n");
    return;
  }
  process.stdout.write(`allow\n${label}\nintent: one transfer to the quote depositAddress\nnot submitted\n`);
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
