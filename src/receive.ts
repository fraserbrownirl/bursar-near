import { readFileSync } from "node:fs";
import { atomicAmount } from "./assets.js";
import { writeAccountCode } from "./code.js";

const BRIDGE = "https://bridge.chaindefuser.com/rpc";

export type BridgeToken = {
  defuse_asset_identifier: string;
  origin_chain_address: string;
  decimals: number;
  asset_name: string;
};

export type ChainRail = {
  id: string;
  kind: "evm" | "sol" | "btc" | "near";
  evmChainId?: number;
  label: string;
};

const RAILS: Record<string, ChainRail> = {
  base: { id: "eth:8453", kind: "evm", evmChainId: 8453, label: "Base" },
  eth: { id: "eth:1", kind: "evm", evmChainId: 1, label: "Ethereum" },
  ethereum: { id: "eth:1", kind: "evm", evmChainId: 1, label: "Ethereum" },
  arb: { id: "eth:42161", kind: "evm", evmChainId: 42161, label: "Arbitrum" },
  arbitrum: { id: "eth:42161", kind: "evm", evmChainId: 42161, label: "Arbitrum" },
  sol: { id: "sol:mainnet", kind: "sol", label: "Solana" },
  solana: { id: "sol:mainnet", kind: "sol", label: "Solana" },
  btc: { id: "btc:mainnet", kind: "btc", label: "Bitcoin" },
  bitcoin: { id: "btc:mainnet", kind: "btc", label: "Bitcoin" },
  near: { id: "near:mainnet", kind: "near", label: "NEAR" },
};

export function rail(chain: string): ChainRail | null {
  const key = chain.trim().toLowerCase();
  if (RAILS[key]) return RAILS[key];
  if (/^eth:\d+$/.test(key) || key === "sol:mainnet" || key === "btc:mainnet" || key === "near:mainnet") {
    const known = Object.values(RAILS).find((item) => item.id === key);
    return known ?? null;
  }
  return null;
}

export async function bridgeRpc(method: string, params: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(BRIDGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(typeof body.error === "string" ? `STOP: ${body.error}` : "STOP: bridge");
  return body.result;
}

/** An address Bursar can receive on. The Intents account id is not one. */
export function receivable(address: string, accountId: string, kind: ChainRail["kind"]): string | null {
  if (!address || address.toLowerCase() === accountId.toLowerCase()) return "STOP: address";
  if (kind === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(address)) return "STOP: address";
  if (kind === "btc" && !/^bc1[a-z0-9]+$/.test(address)) return "STOP: address";
  if (kind === "sol" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "STOP: address";
  if (kind === "near" && !/^[0-9a-f]{64}$/.test(address)) return "STOP: address";
  return null;
}

export function paymentUri(input: {
  rail: ChainRail;
  token: BridgeToken;
  address: string;
  amount?: string;
}): string {
  const human = (input.amount ?? "").trim();
  const atomic = human ? atomicAmount(human, input.token.decimals) : "";
  if (input.rail.kind === "evm") {
    const token = input.token.origin_chain_address;
    const base = `ethereum:${token}@${input.rail.evmChainId}/transfer?address=${input.address}`;
    return atomic ? `${base}&uint256=${atomic}` : base;
  }
  if (input.rail.kind === "sol") {
    const base = `solana:${input.address}?spl-token=${input.token.origin_chain_address}`;
    return human ? `${base}&amount=${human}` : base;
  }
  if (input.rail.kind === "btc") {
    return human ? `bitcoin:${input.address}?amount=${human}` : `bitcoin:${input.address}`;
  }
  const base = `near:${input.address}?token=${input.token.origin_chain_address}`;
  return atomic ? `${base}&amount=${atomic}` : base;
}

export async function receive(input: {
  accountId: string;
  chain: string;
  token: string;
  amount?: string;
  dir?: string;
  fetchImpl?: typeof fetch;
  tokens?: BridgeToken[];
}): Promise<{ uri: string; address: string; chain: string; qr: string }> {
  const chosen = rail(input.chain);
  if (!chosen) throw new Error("STOP: chain");
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokens = input.tokens ?? await tokensOn(chosen.id, fetchImpl);
  const want = input.token.trim().toLowerCase();
  const matches = tokens.filter((token) => token.defuse_asset_identifier.startsWith(`${chosen.id}:`) && token.asset_name.toLowerCase() === want);
  if (matches.length !== 1) throw new Error("STOP: token");
  const token = matches[0]!;
  const result = await bridgeRpc("deposit_address", [{ account_id: input.accountId, chain: chosen.id }], fetchImpl) as { address?: string; chain?: string };
  if (result.chain !== chosen.id || !result.address) throw new Error("STOP: address");
  const stop = receivable(result.address, input.accountId, chosen.kind);
  if (stop) throw new Error(stop);
  const uri = paymentUri({ rail: chosen, token, address: result.address, amount: input.amount });
  const qr = await writeAccountCode(uri, input.dir);
  return { uri, address: result.address, chain: chosen.label, qr };
}

async function tokensOn(chainId: string, fetchImpl: typeof fetch): Promise<BridgeToken[]> {
  const result = await bridgeRpc("supported_tokens", [{}], fetchImpl) as { tokens?: BridgeToken[] };
  return (result.tokens ?? []).filter((token) => token.defuse_asset_identifier.startsWith(`${chainId}:`));
}

export type DepositList = { deposits: Record<string, unknown>[]; total: number };

export async function recentDeposits(accountId: string, chain: string, fetchImpl: typeof fetch = fetch): Promise<DepositList> {
  const chosen = rail(chain);
  if (!chosen) throw new Error("STOP: chain");
  const result = await bridgeRpc("recent_deposits", [{ account_id: accountId, chain: chosen.id }], fetchImpl) as DepositList;
  return { deposits: result.deposits ?? [], total: result.total ?? 0 };
}

/** Observed empty list is waiting. A deposit row is reported only from its own fields. */
export function watchLine(chainId: string, chainLabel: string, token: string, deposits: Record<string, unknown>[]): string {
  const row = deposits.find((item) => typeof item.amount === "string" && (typeof item.sender === "string" || typeof item.from === "string"));
  if (!row) return "waiting";
  const from = String(row.sender ?? row.from);
  const hash = typeof row.tx_hash === "string" ? row.tx_hash : typeof row.hash === "string" ? row.hash : "";
  const link = hash ? explorer(chainId, hash) : "";
  return `Received ${row.amount} ${token} on ${chainLabel} from ${from}.${link}`.trim();
}

function explorer(chainId: string, hash: string): string {
  if (chainId === "eth:8453") return ` https://basescan.org/tx/${hash}`;
  if (chainId === "eth:1") return ` https://etherscan.io/tx/${hash}`;
  if (chainId === "eth:42161") return ` https://arbiscan.io/tx/${hash}`;
  if (chainId === "sol:mainnet") return ` https://solscan.io/tx/${hash}`;
  if (chainId === "btc:mainnet") return ` https://mempool.space/tx/${hash}`;
  if (chainId === "near:mainnet") return ` https://nearblocks.io/txns/${hash}`;
  return "";
}

export function readBridgeFixture(path: string): {
  base: { address: string; chain: string };
  baseUsdc: BridgeToken;
  recent_deposits: DepositList;
} {
  return JSON.parse(readFileSync(path, "utf8"));
}
