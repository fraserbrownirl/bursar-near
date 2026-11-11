import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";

export const CATALOG_URL = "https://mpp.dev/api/services";

/** Tempo push verification in mppx 0.17.0 (`tempo/server/Charge.js`). */
export const TEMPO_MEMO_REASON = "a Tempo push transfer is accepted from whatever account sent it, and the verifier requires an MPP attribution memo bound to the challenge id";

export type CatalogEndpoint = {
  method: string;
  path: string;
  description: string;
  paymentMethod: string;
  currency: string | null;
  amount: string | null;
};

export type CatalogService = {
  id: string;
  name: string;
  description: string;
  serviceUrl: string;
  methods: string[];
  endpoints: CatalogEndpoint[];
};

export type Probe = { status: number; amount: string | null; currency: string | null; chainId: string | null };

export type TokenChain = { blockchain: string; contractAddress: string | null };

export type Payability = { method: string; payable: boolean; reason: string };

type RawService = {
  id?: string;
  name?: string;
  description?: string;
  serviceUrl?: string;
  methods?: Record<string, unknown>;
  categories?: string[];
  tags?: string[];
  endpoints?: {
    method?: string;
    path?: string;
    description?: string;
    payment?: { method?: string; currency?: string; amount?: string };
  }[];
};

export function parseCatalog(body: unknown): CatalogService[] {
  const services = (body as { services?: RawService[] }).services ?? [];
  return services.map((service) => ({
    id: service.id ?? "",
    name: service.name ?? service.id ?? "",
    description: service.description ?? "",
    serviceUrl: service.serviceUrl ?? "",
    methods: Object.keys(service.methods ?? {}),
    endpoints: (service.endpoints ?? []).map((endpoint) => ({
      method: endpoint.method ?? "GET",
      path: endpoint.path ?? "/",
      description: endpoint.description ?? "",
      paymentMethod: endpoint.payment?.method ?? "",
      currency: endpoint.payment?.currency ?? null,
      amount: endpoint.payment?.amount ?? null,
    })),
  }));
}

/**
 * A catalog service Bursar can pay from NEAR through 1Click.
 * Tempo is payable only when 1Click lists the chain. It does not.
 * The memo rule is recorded so a later token-list hit is still not treated as payable.
 */
function methodOf(service: CatalogService): string {
  if (service.methods.includes("nearintents")) return "nearintents";
  if (service.methods.includes("tempo")) return "tempo";
  if (service.methods.includes("evm")) return "evm";
  return service.methods[0] ?? "unknown";
}

function tokenMatches(currency: string, tokens: readonly TokenChain[]): TokenChain | undefined {
  const want = currency.toLowerCase();
  return tokens.find((token) => token.contractAddress?.toLowerCase() === want);
}

export function payability(service: CatalogService, tokens: readonly TokenChain[], probe?: Probe): Payability {
  const method = methodOf(service);
  const chains = new Set(tokens.map((token) => token.blockchain));
  if (method === "nearintents") return { method, payable: true, reason: "nearintents charge" };
  if (method === "tempo") {
    if (!chains.has("tempo")) return { method, payable: false, reason: `1Click lists no tempo chain; ${TEMPO_MEMO_REASON}` };
    return { method, payable: false, reason: TEMPO_MEMO_REASON };
  }
  if (method === "evm") {
    if (!probe || probe.status !== 402 || !probe.amount || !probe.currency) {
      return { method, payable: false, reason: `live response ${probe?.status ?? "not probed"}, no 402` };
    }
    const token = tokenMatches(probe.currency, tokens);
    if (!token) return { method, payable: false, reason: `1Click lists no token ${probe.currency}` };
    return { method, payable: true, reason: `402 ${probe.amount} ${probe.currency} on ${token.blockchain}` };
  }
  return { method, payable: false, reason: `${method} is not a 1Click destination` };
}

export function methodCounts(services: readonly CatalogService[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const service of services) {
    for (const method of service.methods) counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  return counts;
}

export function searchServices(services: readonly CatalogService[], need: string): CatalogService[] {
  const needle = need.trim().toLowerCase();
  if (!needle) return [];
  return services.filter((service) => {
    const hay = [
      service.name,
      service.description,
      service.id,
      ...service.endpoints.flatMap((endpoint) => [endpoint.path, endpoint.description]),
    ].join("\n").toLowerCase();
    return hay.includes(needle);
  });
}

export function summaryLines(services: readonly CatalogService[], tokens: readonly TokenChain[], probes: ReadonlyMap<string, Probe>): string[] {
  const counts = methodCounts(services);
  const methods = ["nearintents", "tempo", "evm", "stripe"];
  const lines = [`catalog ${services.length}`];
  for (const method of methods) {
    const listed = services.filter((service) => service.methods.includes(method));
    const payable = listed.filter((service) => payability(service, tokens, probes.get(service.id)).payable).length;
    lines.push(`${method} ${counts.get(method) ?? 0} payable ${payable}`);
  }
  const any = services.some((service) => payability(service, tokens, probes.get(service.id)).payable);
  if (!any) {
    const evm = services.find((service) => service.methods.includes("evm") && !service.methods.includes("tempo") && !service.methods.includes("nearintents"));
    const probe = evm ? probes.get(evm.id) : undefined;
    const where = evm ? new URL(evm.endpoints[0]?.path ?? "/", evm.serviceUrl.endsWith("/") ? evm.serviceUrl : `${evm.serviceUrl}/`).href : "the evm service";
    lines.push(`no catalog service is payable: 1Click lists no tempo chain, ${TEMPO_MEMO_REASON}, and ${where} returned ${probe?.status ?? "no 402"}`);
  }
  return lines;
}

export async function findReport(need: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const services = await loadCatalog(fetchImpl);
  const tokens = await oneClickTokens();
  const probes = new Map<string, Probe>();
  for (const service of services) {
    if (!service.methods.includes("evm") || service.methods.includes("tempo") || service.methods.includes("nearintents")) continue;
    probes.set(service.id, await probeService(service, fetchImpl));
  }
  const lines = summaryLines(services, tokens, probes);
  try {
    const { bazaarLines, searchBazaar } = await import("./bazaar.js");
    lines.push(...bazaarLines(await searchBazaar(need, fetchImpl)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(message.startsWith("STOP:") ? message : `STOP: bazaar ${message}`);
  }
  for (const service of searchServices(services, need).slice(0, 20)) {
    const row = payability(service, tokens, probes.get(service.id));
    const endpoint = service.endpoints[0];
    const url = endpoint
      ? new URL(endpoint.path, service.serviceUrl.endsWith("/") ? service.serviceUrl : `${service.serviceUrl}/`).href
      : service.serviceUrl;
    lines.push(`${service.id} ${row.method} ${row.payable ? "payable" : "not payable"} ${url}`);
  }
  return lines.join("\n");
}

export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogService[]> {
  const response = await fetchImpl(CATALOG_URL);
  if (!response.ok) throw new Error(`STOP: catalog ${response.status}`);
  return parseCatalog(await response.json());
}

export async function oneClickTokens(): Promise<TokenChain[]> {
  const tokens = await OneClickService.getTokens();
  return tokens.map((token) => ({
    blockchain: (token.blockchain ?? "").toLowerCase(),
    contractAddress: token.contractAddress ?? null,
  }));
}

/** One GET of the service's first endpoint. A non-402 means there is no amount to pay. */
export async function probeService(service: CatalogService, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const endpoint = service.endpoints[0];
  const url = new URL(endpoint?.path ?? "/", service.serviceUrl.endsWith("/") ? service.serviceUrl : `${service.serviceUrl}/`).href;
  const response = await fetchImpl(url, { headers: { accept: "application/json", "accept-payment": "evm/charge" } });
  if (response.status !== 402) return { status: response.status, amount: null, currency: null, chainId: null };
  const decoded = decodeChallenge(response.headers.get("www-authenticate") ?? "");
  return {
    status: 402,
    amount: decoded.amount ?? endpoint?.amount ?? null,
    currency: decoded.currency ?? endpoint?.currency ?? null,
    chainId: decoded.chainId,
  };
}

function decodeChallenge(header: string): { amount: string | null; currency: string | null; chainId: string | null } {
  const encoded = header.match(/request="([^"]+)"/)?.[1];
  if (!encoded) return { amount: null, currency: null, chainId: null };
  try {
    const json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      amount?: string;
      currency?: string;
      methodDetails?: { chainId?: number | string };
    };
    return {
      amount: typeof json.amount === "string" ? json.amount : null,
      currency: typeof json.currency === "string" ? json.currency : null,
      chainId: json.methodDetails?.chainId === undefined ? null : String(json.methodDetails.chainId),
    };
  } catch {
    return { amount: null, currency: null, chainId: null };
  }
}
