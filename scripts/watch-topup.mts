import { appendFileSync, writeFileSync } from "node:fs";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";

const deposit = "abf7fbbc31d1da08d5ad0fd35c11e645cc46ff53f97037f6c2824e32cd6fe2c0";
const origin = "9VNYteHtxuFWSq3QgdEaMtrjVDGdHHZjXTAvGwL8bi2R";
const near = "AqHacPne8YRoj52ZwLmXMQoXuDtp1CgD27CirRmGYbc2";
const seenAt = "2026-11-12T09:30:43.000Z";
const deadline = Date.parse("2026-11-12T10:30:43.000Z");
const historyPath = "demo/payments/topup-history.jsonl";
const supportPath = "demo/payments/near-intents-support.txt";

type Row = { at: string; status: string; updatedAt: string; deposited: string; amountOut: string };

const history: Row[] = [{
  at: seenAt,
  status: "PROCESSING",
  updatedAt: seenAt,
  deposited: "2.0",
  amountOut: "",
}];

function remember(row: Row): void {
  history.push(row);
  appendFileSync(historyPath, JSON.stringify(row) + "\n");
  process.stdout.write(`${row.at} ${row.status} deposited ${row.deposited} out ${row.amountOut}\n`);
}

function support(): void {
  const lines = [
    "NEAR Intents support",
    `deposit address: ${deposit}`,
    `origin transaction: ${origin}`,
    `near transaction: ${near}`,
    `1Click first reported the 2 NEAR deposit at ${seenAt}`,
    "status history:",
    ...history.map((row) => `${row.at} status ${row.status} updatedAt ${row.updatedAt} deposited ${row.deposited || "-"} amountOut ${row.amountOut || "-"}`),
    `Still PROCESSING one hour after ${seenAt}.`,
  ];
  writeFileSync(supportPath, lines.join("\n") + "\n");
  process.stdout.write(`wrote ${supportPath}\n`);
}

while (Date.now() < deadline) {
  const body = await OneClickService.getExecutionStatus(deposit);
  const row: Row = {
    at: new Date().toISOString(),
    status: body.status ?? "",
    updatedAt: body.updatedAt ?? "",
    deposited: body.swapDetails?.depositedAmountFormatted ?? "",
    amountOut: body.swapDetails?.amountOutFormatted ?? "",
  };
  remember(row);
  if (row.status !== "PROCESSING") {
    process.stdout.write(`left PROCESSING: ${row.status}\n`);
    process.exit(0);
  }
  const wait = Math.min(30_000, deadline - Date.now());
  if (wait <= 0) break;
  await new Promise((resolve) => setTimeout(resolve, wait));
}

const last = await OneClickService.getExecutionStatus(deposit);
const finalRow: Row = {
  at: new Date().toISOString(),
  status: last.status ?? "",
  updatedAt: last.updatedAt ?? "",
  deposited: last.swapDetails?.depositedAmountFormatted ?? "",
  amountOut: last.swapDetails?.amountOutFormatted ?? "",
};
remember(finalRow);
if (finalRow.status === "PROCESSING") support();
else process.stdout.write(`left PROCESSING: ${finalRow.status}\n`);
