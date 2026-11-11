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
export function parseBazaar(body: unknown, need: string): BazaarHit[] {
  const needle = need.trim().toLowerCase();
  const items = (body as { items?: RawItem[] }).items ?? [];
  const hits: BazaarHit[] = [];
  for (const item of items) {
    const accept = item.accepts?.[0];
    const resource = item.resource ?? "";
    const description = item.description ?? "";
    const serviceName = item.serviceName ?? "";
    const hay = `${resource}\n${description}\n${serviceName}`.toLowerCase();
    if (needle && !hay.includes(needle)) continue;
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

export function bazaarLines(hits: readonly BazaarHit[]): string[] {
  const payable = hits.filter((hit) => hit.payable).length;
  const lines = [`bazaar ${hits.length} payable ${payable}`];
  for (const hit of hits.slice(0, 20)) {
    lines.push(`${hit.payable ? "payable" : "not payable"} ${hit.amount} ${hit.network} ${hit.resource}`);
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
