import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BlocklistEntry = { reason: string; evidenceHash: string };

const bundled = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/blocklist.json");

/** Path of the blocklist fixture. `BURSAR_BLOCKLIST` overrides the bundled file. */
export function blocklistPath(): string {
  return process.env.BURSAR_BLOCKLIST ?? bundled;
}

/**
 * `get(account)` against the fixture file.
 * The file is the source until a testnet contract account is set.
 * A missing file is a failed read, not an empty list.
 */
export function readBlocklist(path = blocklistPath()): { path: string; accounts: Record<string, BlocklistEntry>; missing: boolean } {
  if (!existsSync(path)) return { path, accounts: {}, missing: true };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    accounts?: Record<string, { reason?: string; evidence_hash?: string }>;
  };
  const accounts: Record<string, BlocklistEntry> = {};
  for (const [account, entry] of Object.entries(parsed.accounts ?? {})) {
    accounts[account] = {
      reason: entry.reason ?? "listed",
      evidenceHash: entry.evidence_hash ?? "",
    };
  }
  return { path, accounts, missing: false };
}
