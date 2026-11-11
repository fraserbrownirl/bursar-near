import { oneClickTokens, payability, type CatalogService, type Probe } from "./catalog.js";

/** Pay a catalog URL. A nearintents 402 uses the existing payer. Anything else stops before a key is used. */
export async function payCatalog(url: string): Promise<number> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "accept-payment": "nearintents/charge, tempo/charge, evm/charge" },
  });
  const header = response.headers.get("www-authenticate") ?? "";
  const method = header.match(/method="([^"]+)"/)?.[1] ?? "";
  if (response.status === 402 && response.headers.get("payment-required")) {
    const accountId = process.env.BURSAR_NEAR_ACCOUNT;
    if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
    const { payX402 } = await import("./x402-pay.js");
    return payX402(url, accountId);
  }
  if (response.status === 402 && method === "nearintents") {
    const accountId = process.env.BURSAR_NEAR_ACCOUNT;
    if (!accountId) throw new Error("BURSAR_NEAR_ACCOUNT is required");
    const { payUrl } = await import("./mpp-pay.js");
    return payUrl(url, accountId);
  }
  if (response.status !== 402) {
    process.stdout.write(`STOP: ${response.status} no 402\n`);
    return 1;
  }
  const tokens = await oneClickTokens();
  const probe = decodeProbe(response.status, header);
  const service: CatalogService = {
    id: url,
    name: url,
    description: "",
    serviceUrl: url,
    methods: [method || "unknown"],
    endpoints: [],
  };
  const row = payability(service, tokens, probe);
  process.stdout.write(`STOP: ${row.reason}\n`);
  return 1;
}

function decodeProbe(status: number, header: string): Probe {
  const encoded = header.match(/request="([^"]+)"/)?.[1];
  if (!encoded) return { status, amount: null, currency: null, chainId: null };
  try {
    const json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      amount?: string;
      currency?: string;
      methodDetails?: { chainId?: number | string };
    };
    return {
      status,
      amount: typeof json.amount === "string" ? json.amount : null,
      currency: typeof json.currency === "string" ? json.currency : null,
      chainId: json.methodDetails?.chainId === undefined ? null : String(json.methodDetails.chainId),
    };
  } catch {
    return { status, amount: null, currency: null, chainId: null };
  }
}
