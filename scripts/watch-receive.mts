import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { intentsUsdc } from "../src/base-float.js";
import { ENCLAVE_ACCOUNT } from "../src/near-topup.js";
import { recentDeposits, watchLine } from "../src/receive.js";

const runsheet = "demo/payments/runsheet.md";
const need = 110_000n;
const rails = [
  { chain: "base", id: "eth:8453", label: "Base" },
  { chain: "sol", id: "sol:mainnet", label: "Solana" },
];
const seen = new Set<string>();

function record(label: string, result: string): void {
  if (seen.has(label)) return;
  seen.add(label);
  const lines = readFileSync(runsheet, "utf8").split("\n");
  const index = lines.findIndex((line) => line.startsWith(`| ${label} |`));
  if (index < 0) return;
  if (!lines[index].includes("| result |") && !lines[index].endsWith(`${result} |`)) {
    lines[index] = lines[index].replace(/\s*\|\s*$/, ` | ${result.replaceAll("|", "/")} |`);
  }
  const header = lines.findIndex((line) => line.startsWith("| chain |"));
  if (header >= 0 && !lines[header].includes("result")) {
    lines[header] = lines[header].replace(/\s*\|\s*$/, " | result |");
    lines[header + 1] = lines[header + 1].replace(/\s*\|\s*$/, " | --- |");
  }
  writeFileSync(runsheet, lines.join("\n"));
  process.stdout.write(`scan ${label}: ${result}\n`);
}

async function premium(): Promise<void> {
  const pay = spawn("npx", ["tsx", "src/cli.ts", "pay", "http://127.0.0.1:8402/premium"], { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => pay.on("close", (status) => resolve(status ?? 1)));
  process.stdout.write(`premium exit ${code}\n`);
}

for (let i = 0; i < 240; i += 1) {
  let got = false;
  for (const rail of rails) {
    const list = await recentDeposits(ENCLAVE_ACCOUNT, rail.chain);
    const line = watchLine(rail.id, rail.label, "USDC", list.deposits);
    if (line !== "waiting") {
      got = true;
      record(rail.label, line);
    }
  }
  const balance = await intentsUsdc(ENCLAVE_ACCOUNT);
  process.stdout.write(`balance ${balance.toString()} receive ${got}\n`);
  if (got && balance >= need) {
    await premium();
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
