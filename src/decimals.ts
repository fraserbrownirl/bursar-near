import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { dir } from "./store.js";

export type TokenRow = { assetId: string; decimals: number; symbol?: string };

const recorded = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/tokens.json");

export function readTokenFile(path: string): TokenRow[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TokenRow[];
  return parsed.filter((row) => typeof row.assetId === "string" && typeof row.decimals === "number");
}

/** Cache from a previous `getTokens()` call, else the recorded fixture. */
export function cachedTokens(): TokenRow[] {
  const cached = join(dir(), "tokens.json");
  if (existsSync(cached)) return readTokenFile(cached);
  if (existsSync(recorded)) return readTokenFile(recorded);
  return [];
}

export async function loadTokens(fetchLive = process.env.BURSAR_TOKENS_LIVE === "1"): Promise<TokenRow[]> {
  if (!fetchLive) return cachedTokens();
  const tokens = await OneClickService.getTokens();
  const rows = tokens.map((token) => ({ assetId: token.assetId, decimals: token.decimals, symbol: token.symbol }));
  writeFileSync(join(dir(), "tokens.json"), JSON.stringify(rows));
  return rows;
}

export function decimalsFor(assetId: string, rows: readonly TokenRow[]): number {
  const found = rows.find((row) => row.assetId === assetId);
  if (!found) throw new Error("STOP: unknown decimals");
  return found.decimals;
}
