import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

export type BlocklistReport = {
  reporter: string;
  reason: string;
  evidenceHash: string;
  blockHeight?: string;
};

export function trustedReporters(): string[] {
  return (env("BURSAR_TRUSTED_REPORTERS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function bundledBlocklist(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../fixtures/blocklist.json");
}

/**
 * When set, `get` is a view call on this mainnet contract.
 * Unset, the check uses the fixture file so tests make no network call.
 */
export function blocklistContract(): string | undefined {
  return env("BURSAR_BLOCKLIST_CONTRACT");
}

/** Path of the blocklist fixture. `BURSAR_BLOCKLIST` overrides the bundled file. */
export function blocklistPath(): string {
  return env("BURSAR_BLOCKLIST") ?? bundledBlocklist();
}

/**
 * `get(account)` against the fixture file.
 * The file is the source until a mainnet contract account is set.
 * A missing file is a failed read, not an empty list.
 */
function asReports(value: unknown): BlocklistReport[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((entry) => {
    const row = entry as { reporter?: string; reason?: string; evidence_hash?: string; evidenceHash?: string; block_height?: number | string; blockHeight?: string };
    return {
      reporter: row.reporter ?? "",
      reason: row.reason ?? "listed",
      evidenceHash: row.evidence_hash ?? row.evidenceHash ?? "",
      blockHeight: row.block_height === undefined ? row.blockHeight : String(row.block_height),
    };
  });
}

export function readBlocklist(path = blocklistPath()): { path: string; accounts: Record<string, BlocklistReport[]>; missing: boolean } {
  if (!existsSync(path)) return { path, accounts: {}, missing: true };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { accounts?: Record<string, unknown> };
  const accounts: Record<string, BlocklistReport[]> = {};
  for (const [account, entry] of Object.entries(parsed.accounts ?? {})) accounts[account] = asReports(entry);
  return { path, accounts, missing: false };
}

function encodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Fixture file, or one `get` on the contract when `BURSAR_BLOCKLIST_CONTRACT` is set.
 * `BURSAR_BLOCKLIST_RPC` overrides the RPC. The default is mainnet.
 */
export async function loadBlocklist(
  receiver: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ path: string; accounts: Record<string, BlocklistReport[]>; missing: boolean }> {
  const contract = blocklistContract();
  if (!contract) return readBlocklist();
  const rpc = env("BURSAR_BLOCKLIST_RPC") ?? env("NEAR_RPC_URL") ?? "https://rpc.mainnet.near.org";
  try {
    const response = await fetchImpl(rpc, {
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
          args_base64: encodeJson({ account: receiver }),
        },
      }),
    });
    const body = await response.json() as { result?: { result?: number[] } };
    const bytes = body.result?.result;
    if (!bytes) return { path: contract, accounts: {}, missing: true };
    const text = new TextDecoder().decode(Uint8Array.from(bytes));
    if (text === "null" || text === "[]") return { path: contract, accounts: {}, missing: false };
    return { path: contract, accounts: { [receiver]: asReports(JSON.parse(text)) }, missing: false };
  } catch {
    return { path: contract, accounts: {}, missing: true };
  }
}
