import { injectionReason, scanForInstructions } from "./guard/injection.js";
import { referenceUi } from "./model.js";
import { MPP_LIMIT_ATOMIC } from "./mpp.js";
import { normInt } from "./quote.js";

/** USDC on Base. Circle's contract. */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export const BASE_NETWORK = "eip155:8453";

/** One USDC. A Base float top-up is this size when it is above the route minimum. */
export const TOP_UP_ATOMIC = 1_000_000n;

export type X402Accept = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  description: string;
  resourceUrl: string;
  transfer: string;
};

export type X402Review = { stop: string | null; card: string; accept: X402Accept | null };

/** 1 USDC when that is strictly above the route minimum. Otherwise no top-up size. */
export function topUpChunk(routeMinimumAtomic: string | undefined): string | null {
  const min = normInt(routeMinimumAtomic ?? "0");
  if (min === null) return null;
  if (TOP_UP_ATOMIC <= BigInt(min)) return null;
  return TOP_UP_ATOMIC.toString();
}

export function needsTopUp(balanceAtomic: bigint, paymentAtomic: bigint): boolean {
  return balanceAtomic < paymentAtomic;
}

type RequiredBody = {
  resource?: { url?: string; description?: string };
  accepts?: {
    scheme?: string;
    network?: string;
    amount?: string;
    asset?: string;
    payTo?: string;
    extra?: { assetTransferMethod?: string };
  }[];
};

/** The Base USDC exact option, if the 402 offers one. */
export function baseExact(body: unknown): X402Accept | null {
  const parsed = body as RequiredBody;
  for (const accept of parsed.accepts ?? []) {
    const transfer = accept.extra?.assetTransferMethod ?? "eip3009";
    if (accept.scheme !== "exact" || accept.network !== BASE_NETWORK || transfer !== "eip3009") continue;
    if ((accept.asset ?? "").toLowerCase() !== BASE_USDC) continue;
    if (!accept.amount || !accept.payTo) continue;
    return {
      scheme: "exact",
      network: BASE_NETWORK,
      amount: accept.amount,
      asset: accept.asset ?? BASE_USDC,
      payTo: accept.payTo,
      description: parsed.resource?.description ?? "",
      resourceUrl: parsed.resource?.url ?? "",
      transfer,
    };
  }
  return null;
}

export function decodePaymentRequired(header: string): unknown {
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

/**
 * Evidence, injection, and the amount cap. A Base exact USDC challenge with a
 * clean description passes. Anything else stops before a signature.
 */
export function reviewX402(body: unknown, limitAtomic = MPP_LIMIT_ATOMIC): X402Review {
  const accept = baseExact(body);
  if (!accept) return { stop: "STOP: not Base exact USDC", card: "", accept: null };
  const name = accept.description.trim() || accept.resourceUrl || accept.payTo;
  const card = `Pay ${referenceUi(accept.amount, 6)} USDC to ${name}?`;
  const amount = normInt(accept.amount);
  const limit = normInt(limitAtomic);
  if (amount === null || limit === null || BigInt(amount) > BigInt(limit)) return { stop: "STOP: limit", card, accept: null };
  if (!/^0x[0-9a-fA-F]{40}$/.test(accept.payTo)) return { stop: "STOP: payee", card, accept: null };
  const text = [accept.description, accept.resourceUrl].filter((item) => item.trim() !== "").join("\n");
  if (text !== "") {
    const findings = scanForInstructions([{ where: "402", text }]);
    if (findings.length > 0) return { stop: `STOP: ${injectionReason(findings)}`, card, accept: null };
  }
  return { stop: null, card, accept };
}
