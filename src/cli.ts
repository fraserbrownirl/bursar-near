import { pathToFileURL } from "node:url";
import { readBlocklist } from "./blocklist.js";
import { decide, formatCheck } from "./decide.js";
import { loadFacts } from "./load.js";
import { readPayeeMap } from "./payees.js";

export type Args = {
  receiver: string;
  amount?: string;
  token?: string;
  request?: string;
};

export class UsageError extends Error {}

function usage(): never {
  throw new UsageError("bursar check <receiver> [--amount <amount>] [--token <token>] [--request <text>]");
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const facts = await loadFacts(args.receiver);
  const result = decide({
    receiver: args.receiver,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount: args.amount,
    token: args.token,
    request: args.request,
    facts,
    payees: readPayeeMap(),
    blocklist: readBlocklist(),
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
