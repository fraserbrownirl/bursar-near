import { BASE_NETWORK, BASE_USDC, baseExact } from "./x402.js";

export const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

export type BazaarHit = {
  resource: string;
  description: string;
  serviceName: string;
  amount: string;
  network: string;
  scheme: string;
  asset: string;
  payable: boolean;
};

type RawItem = {
  resource?: string;
  description?: string;
  serviceName?: string;
  accepts?: { scheme?: string; network?: string; amount?: string; asset?: string; payTo?: string; extra?: { assetTransferMethod?: string } }[];
};

/** Base exact USDC is payable. Every other Bazaar row is listed and marked not payable. */
const STOP_WORDS = new Set(["the", "and", "for", "one", "call", "find", "get", "pay", "paid", "api", "apis", "service", "me", "you", "with", "that", "this", "from"]);

/** Significant words of the need. A row stays when any of them appears in it. */
export function needleWords(need: string): string[] {
  return need.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function parseBazaar(body: unknown, need: string): BazaarHit[] {
  const words = needleWords(need);
  const items = (body as { items?: RawItem[] }).items ?? [];
  const hits: BazaarHit[] = [];
  for (const item of items) {
    const accept = item.accepts?.[0];
    const resource = item.resource ?? "";
    const description = item.description ?? "";
    const serviceName = item.serviceName ?? "";
    const hay = `${resource}\n${description}\n${serviceName}`.toLowerCase();
    if (words.length > 0 && !words.some((word) => hay.includes(word))) continue;
    const exact = baseExact({
      resource: { url: resource, description },
      accepts: accept ? [accept] : [],
    });
    hits.push({
      resource,
      description,
      serviceName,
      amount: accept?.amount ?? "",
      network: accept?.network ?? "",
      scheme: accept?.scheme ?? "",
      asset: accept?.asset ?? "",
      payable: exact !== null && exact.network === BASE_NETWORK && exact.asset.toLowerCase() === BASE_USDC,
    });
  }
  return hits;
}

/** Atomic USDC (6 decimals) as the owner says it: 1000 is "0.001 USDC". */
export function displayUsdc(atomic: string): string {
  const value = Number(atomic);
  if (!Number.isFinite(value) || !/^\d+$/.test(atomic)) return atomic;
  return `${value / 1_000_000} USDC (${atomic} atomic)`;
}

export function bazaarLines(hits: readonly BazaarHit[]): string[] {
  const payable = hits.filter((hit) => hit.payable).length;
  const lines = [`bazaar ${hits.length} payable ${payable}`];
  for (const hit of hits.slice(0, 20)) {
    lines.push(`${hit.payable ? "payable" : "not payable"} ${displayUsdc(hit.amount)} ${hit.network} ${hit.resource}`);
  }
  return lines;
}

export async function searchBazaar(need: string, fetchImpl: typeof fetch = fetch): Promise<BazaarHit[]> {
  const url = new URL(BAZAAR_URL);
  url.searchParams.set("limit", "50");
  if (need.trim()) url.searchParams.set("query", need.trim());
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`STOP: bazaar ${response.status}`);
  return parseBazaar(await response.json(), need);
}
