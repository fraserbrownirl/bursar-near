import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listReceipts } from "./receipt.js";
import { referenceCommand } from "./reference.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function python(): string {
  if (process.env.BURSAR_PYTHON) return process.env.BURSAR_PYTHON;
  const mac = process.env.BURSAR_ETHEREUS_MAC ?? join(root, "../ethereus-mac");
  const candidate = join(mac, ".venv/bin/python");
  return existsSync(candidate) ? candidate : "python3";
}

type Run = { output: string; trace_tokens: number; trace_sha256: string; wall_ms: number };

function computer(cmd: string): Run {
  const result = spawnSync(python(), [join(root, "scripts/computer_run.py"), cmd], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "computer run failed\n");
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout) as Run;
}

async function main(): Promise<void> {
  const cmd = process.argv.slice(2).join(" ").trim();
  if (cmd) {
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
  const rows = listReceipts();
  if (rows.length === 0) {
    process.stdout.write("no receipts\n");
    process.exit(1);
  }
  let bad = 0;
  for (const { hash, receipt } of rows) {
    const run = computer(receipt.cmd);
    const ok = run.output === receipt.output && run.trace_sha256 === receipt.trace_sha256;
    bad += ok ? 0 : 1;
    process.stdout.write(`${hash} ${ok ? "match" : "MISMATCH"} ${receipt.cmd}\n`);
  }
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
