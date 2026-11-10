import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BlocklistEntry = { reason: string; evidenceHash: string };

const bundled = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/blocklist.json");

/**
 * When set, `get` is a view call on this testnet contract.
 * Deployed 2026-11-10 as `bursar-bl-0db1ecc7.testnet`.
 * Unset, the check uses the fixture file so tests make no network call.
 */
export function blocklistContract(): string | undefined {
  return process.env.BURSAR_BLOCKLIST_CONTRACT;
}

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

/** Fixture file, or one `get` on the testnet contract when `BURSAR_BLOCKLIST_CONTRACT` is set. */
export async function loadBlocklist(receiver: string): Promise<{ path: string; accounts: Record<string, BlocklistEntry>; missing: boolean }> {
  const contract = blocklistContract();
  if (!contract) return readBlocklist();
  const rpc = process.env.NEAR_TESTNET_RPC ?? "https://rpc.testnet.near.org";
  try {
    const args = Buffer.from(JSON.stringify({ account: receiver })).toString("base64");
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contract,
          method_name: "get",
          args_base64: args,
        },
      }),
    });
    const body = await response.json() as { result?: { result?: number[] } };
    const bytes = body.result?.result;
    if (!bytes) return { path: contract, accounts: {}, missing: true };
    const text = Buffer.from(bytes).toString("utf8");
    if (text === "null") return { path: contract, accounts: {}, missing: false };
    const report = JSON.parse(text) as { reason?: string; evidence_hash?: string };
    return {
      path: contract,
      accounts: {
        [receiver]: { reason: report.reason ?? "listed", evidenceHash: report.evidence_hash ?? "" },
      },
      missing: false,
    };
  } catch {
    return { path: contract, accounts: {}, missing: true };
  }
}
