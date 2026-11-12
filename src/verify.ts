import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listReceipts, receiptsDir, sha256Bytes, type Receipt } from "./receipt.js";
import { referenceCommand } from "./reference.js";

export type Verdict = "match" | "MISMATCH";

function inputDir(): string {
  return join(receiptsDir(), "inputs");
}

function filesFor(receipt: Receipt): Record<string, Buffer> | null {
  const files: Record<string, Buffer> = {};
  for (const [name, want] of Object.entries(receipt.inputs)) {
    const named = join(inputDir(), name);
    const hashed = join(inputDir(), want);
    const path = existsSync(hashed) ? hashed : named;
    if (!existsSync(path)) return null;
    const bytes = readFileSync(path);
    if (sha256Bytes(bytes) !== want) return null;
    files[name] = bytes;
  }
  return files;
}

/** Recompute one receipt's output with the reference implementations. */
export async function verifyOne(receipt: Receipt): Promise<Verdict> {
  const files = filesFor(receipt);
  if (!files) return "MISMATCH";
  try {
    const got = await referenceCommand(receipt.cmd, files);
    return got === receipt.output ? "match" : "MISMATCH";
  } catch {
    return "MISMATCH";
  }
}

export async function verifyAll(): Promise<{ hash: string; verdict: Verdict }[]> {
  const rows = [];
  for (const { hash, receipt } of listReceipts()) {
    const body = readFileSync(join(receiptsDir(), `${hash}.json`));
    const named = createHash("sha256").update(body).digest("hex");
    if (named !== hash) {
      rows.push({ hash, verdict: "MISMATCH" as const });
      continue;
    }
    rows.push({ hash, verdict: await verifyOne(receipt) });
  }
  return rows;
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2).filter((arg) => /^[0-9a-f]{64}$/.test(arg)));
  const rows = (await verifyAll()).filter((row) => only.size === 0 || only.has(row.hash));
  if (rows.length === 0) {
    process.stdout.write("no receipts\n");
    process.exit(1);
  }
  let bad = 0;
  for (const row of rows) {
    process.stdout.write(`${row.hash} ${row.verdict}\n`);
    if (row.verdict !== "match") bad += 1;
  }
  process.exit(bad === 0 ? 0 : 1);
}

const isDirect = process.argv[1] !== undefined && process.argv[1].endsWith("verify.ts");
if (isDirect) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
