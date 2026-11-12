import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listReceipts, type Receipt } from "./receipt.js";
import { referenceCommand } from "./reference.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function python(): string {
  if (process.env.BURSAR_PYTHON) return process.env.BURSAR_PYTHON;
  const vendored = join(root, ".venv-verify/bin/python");
  if (existsSync(vendored)) return vendored;
  const mac = process.env.BURSAR_ETHEREUS_MAC ?? join(root, "../ethereus-mac");
  const candidate = join(mac, ".venv/bin/python");
  return existsSync(candidate) ? candidate : "python3";
}

type Run = { output: string; trace_tokens: number; trace_sha256: string; wall_ms: number };

function computer(cmd: string, files?: Record<string, string>, elf?: string): Run {
  const args = [join(root, "scripts/computer_run.py"), cmd];
  let staging = "";
  if (files && Object.keys(files).length > 0) {
    staging = mkdtempSync(join(tmpdir(), "bursar-inputs-"));
    const path = join(staging, "files.json");
    writeFileSync(path, JSON.stringify(files));
    args.push(path);
  }
  try {
    const result = spawnSync(python(), args, {
      encoding: "utf8",
      env: { ...process.env, ...(elf ? { BURSAR_RECEIPT_ELF: elf } : {}) },
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || "computer run failed\n");
      process.exit(result.status ?? 1);
    }
    return JSON.parse(result.stdout) as Run;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2).filter((arg) => /^[0-9a-f]{64}$/.test(arg)));
  const cmd = process.argv.slice(2).filter((arg) => !only.has(arg)).join(" ").trim();
  if (cmd && only.size === 0) {
    const run = computer(cmd);
    let reference = "no reference";
    try {
      reference = await referenceCommand(cmd);
    } catch (error) {
      reference = error instanceof Error ? error.message : String(error);
    }
    process.stdout.write(`output: ${run.output}\n`);
    process.stdout.write(`trace_sha256: ${run.trace_sha256}\n`);
    process.stdout.write(`trace_tokens: ${run.trace_tokens}\n`);
    process.stdout.write(`reference: ${reference}\n`);
    return;
  }
  const rows = listReceipts().filter((row) => only.size === 0 || only.has(row.hash));
  if (only.size > 0) {
    const found = new Set(rows.map((row) => row.hash));
    for (const hash of only) {
      if (found.has(hash)) continue;
      const path = join(root, "receipts", `${hash}.json`);
      if (!existsSync(path)) continue;
      rows.push({ hash, receipt: JSON.parse(readFileSync(path, "utf8")) as Receipt });
    }
  }
  if (rows.length === 0) {
    process.stdout.write("no receipts\n");
    process.exit(1);
  }
  let bad = 0;
  for (const { hash, receipt } of rows) {
    const files: Record<string, string> = {};
    for (const [name, digest] of Object.entries(receipt.inputs)) {
      const hashed = join(root, "receipts/inputs", digest);
      const named = join(root, "receipts/inputs", name);
      const path = existsSync(hashed) ? hashed : named;
      files[name] = readFileSync(path, "utf8");
    }
    const run = computer(receipt.cmd, files, receipt.firmware_elf_sha256);
    const ok = run.output === receipt.output && run.trace_sha256 === receipt.trace_sha256;
    bad += ok ? 0 : 1;
    process.stdout.write(`${hash} ${ok ? "match" : "MISMATCH"} ${receipt.cmd} wall_ms ${run.wall_ms}\n`);
  }
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
