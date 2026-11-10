import { readLedger, type LedgerEntry } from "./guard/ledger.js";

export const HISTORY_HEADER = "date,recipient,chain,amount,fee,verdict,transaction,receipts";

function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(" ") : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function row(entry: LedgerEntry): string | null {
  const data = entry.data;
  const recipient = data.recipient ?? data.receiver;
  if (recipient === undefined && data.verdict === undefined && data.transaction === undefined) return null;
  return [
    entry.ts,
    recipient ?? "",
    data.chain ?? "",
    data.amount ?? "",
    data.fee ?? "",
    data.verdict ?? "",
    data.transaction ?? "",
    data.receipts ?? data.receipt ?? "",
  ].map(cell).join(",");
}

/** One CSV line per ledger entry that names a receiver, a verdict, or a transaction. */
export function historyCsv(entries: readonly LedgerEntry[] = readLedger()): string {
  const lines = [HISTORY_HEADER];
  for (const entry of entries) {
    const line = row(entry);
    if (line) lines.push(line);
  }
  return lines.join("\n") + "\n";
}
