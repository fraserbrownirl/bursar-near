import { isNearAccount } from "./account.js";
import { cachedTokens, loadTokens, type TokenRow } from "./decimals.js";

/** `0.25` with 6 decimals is `250000`. A non-decimal is refused. */
export function atomicAmount(human: string, decimals: number): string {
  const [whole, frac = ""] = human.trim().split(".");
  if (!/^\d+$/.test(whole ?? "") || !/^\d*$/.test(frac)) throw new Error("STOP: amount");
  const digits = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(digits || "0")).toString();
}

/** NEAR native USDC. The Intents balance the chat spends. Decimals 6 in test/fixtures/tokens.json. */
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export type Asset = { assetId: string; decimals: number; blockchain: string; symbol: string };

/** Chain from the token row, or from a `nep141:<chain>-` id. Anything else is NEAR. */
export function chainOf(row: TokenRow): string {
  if (row.blockchain) return row.blockchain.toLowerCase();
  const prefixed = row.assetId.toLowerCase().match(/^nep141:([a-z0-9]+)-/);
  if (prefixed?.[1]) return prefixed[1];
  return "near";
}

/** One symbol on one chain. Several matches, or none, is a question. */
export function resolveAsset(rows: readonly TokenRow[], symbol: string, chain: string): Asset | { ask: string } {
  const want = symbol.toUpperCase();
  const where = chain.toLowerCase();
  const hits = rows.filter((row) => (row.symbol ?? "").toUpperCase() === want && chainOf(row) === where);
  if (hits.length === 0) return { ask: `I don't know ${want} on ${where}.` };
  if (hits.length > 1) return { ask: `Which ${want} on ${where}?` };
  const row = hits[0]!;
  return { assetId: row.assetId, decimals: row.decimals, blockchain: chainOf(row), symbol: want };
}

export function originUsdc(rows: readonly TokenRow[]): Asset {
  const found = resolveAsset(rows, "USDC", "near");
  if ("ask" in found) return { assetId: NEAR_USDC, decimals: 6, blockchain: "near", symbol: "USDC" };
  return found;
}

export type Priced = {
  origin: Asset;
  dest: Asset;
  amount: string;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
};

/**
 * The owner spends NEAR USDC. The destination is the symbol on the chain they named.
 * A NEAR account with no chain is NEAR. Any other address with no chain is a question.
 * The same asset is an exact input. A different asset is an exact output of that amount.
 */
export function pricePayment(
  rows: readonly TokenRow[],
  heard: { to: string; human: string; asset: string; chain: string },
): Priced | { ask: string } {
  const chain = heard.chain || (isNearAccount(heard.to) ? "near" : "");
  if (!chain) return { ask: "Which chain?" };
  const dest = resolveAsset(rows, heard.asset || "USDC", chain);
  if ("ask" in dest) return dest;
  const origin = originUsdc(rows);
  const same = dest.assetId === origin.assetId;
  try {
    const amount = atomicAmount(heard.human, same ? origin.decimals : dest.decimals);
    return { origin, dest, amount, swapType: same ? "EXACT_INPUT" : "EXACT_OUTPUT" };
  } catch {
    return { ask: `How much is that in ${dest.symbol}?` };
  }
}

/** Cache first. A missing chain refreshes the 1Click token list once. */
export async function rowsFor(symbol: string, chain: string): Promise<TokenRow[]> {
  const cached = cachedTokens();
  if (!("ask" in resolveAsset(cached, symbol, chain))) return cached;
  try {
    return await loadTokens(true);
  } catch {
    return cached;
  }
}
