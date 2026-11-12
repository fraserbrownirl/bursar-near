import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One in-weights call. The file name is the SHA-256 of these bytes. */
export type Receipt = {
  cmd: string;
  /** File name → SHA-256 of the bytes the command read. */
  inputs: Record<string, string>;
  firmware_elf_sha256: string;
  chip_weights_sha256: string;
  output: string;
  trace_tokens: number;
  trace_sha256: string;
  wall_ms: number;
  runtime: "locals-mac";
  date: string;
};

export function receiptsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../receipts");
}

export function sha256Bytes(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Token ids in generation order, each a uint32 little-endian. */
export function traceSha256(ids: readonly number[]): string {
  const buf = Buffer.alloc(ids.length * 4);
  ids.forEach((id, i) => {
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error("a trace token id is a uint32");
    buf.writeUInt32LE(id, i * 4);
  });
  return sha256Bytes(buf);
}

export function canonicalReceipt(receipt: Receipt): string {
  const inputs: Record<string, string> = {};
  for (const name of Object.keys(receipt.inputs).sort()) inputs[name] = receipt.inputs[name];
  const ordered = {
    cmd: receipt.cmd,
    inputs,
    firmware_elf_sha256: receipt.firmware_elf_sha256,
    chip_weights_sha256: receipt.chip_weights_sha256,
    output: receipt.output,
    trace_tokens: receipt.trace_tokens,
    trace_sha256: receipt.trace_sha256,
    wall_ms: receipt.wall_ms,
    runtime: receipt.runtime,
    date: receipt.date,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function receiptHash(receipt: Receipt): string {
  return sha256Bytes(canonicalReceipt(receipt));
}

export function ledgerPath(): string {
  return join(receiptsDir(), "ledger.txt");
}

/** SHA-256 of the ledger file. Empty ledger hashes the empty byte string. */
export function ledgerHead(): string {
  const path = ledgerPath();
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  return sha256Bytes(bytes);
}

export function writeReceipt(receipt: Receipt): { hash: string; path: string } {
  const body = canonicalReceipt(receipt);
  const hash = sha256Bytes(body);
  const dir = receiptsDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${hash}.json`);
  if (!existsSync(path)) writeFileSync(path, body);
  const ledger = ledgerPath();
  const lines = existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter(Boolean) : [];
  if (!lines.includes(hash)) appendFileSync(ledger, `${hash}\n`);
  return { hash, path };
}

function receiptFiles(): string[] {
  const dir = receiptsDir();
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
  let tracked: Set<string> | null = null;
  try {
    const root = join(dir, "..");
    const listed = execFileSync("git", ["ls-files", "receipts"], { cwd: root, encoding: "utf8" });
    tracked = new Set(
      listed.split("\n").filter((line) => /^receipts\/[0-9a-f]{64}\.json$/.test(line)).map((line) => line.slice("receipts/".length)),
    );
  } catch {
    tracked = null;
  }
  return names.filter((name) => tracked === null || tracked.has(name)).sort();
}

/** Receipts git tracks. Untracked files in the working tree are ignored. */
export function listReceipts(): { hash: string; receipt: Receipt }[] {
  const dir = receiptsDir();
  return receiptFiles().map((name) => {
    const hash = name.slice(0, 64);
    const receipt = JSON.parse(readFileSync(join(dir, name), "utf8")) as Receipt;
    return { hash, receipt };
  });
}
