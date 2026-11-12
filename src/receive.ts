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

/** This account's deposit address on a chain. No code is drawn. */
export async function depositAccount(input: {
  accountId: string;
  chain: string;
  token: string;
  fetchImpl?: typeof fetch;
  tokens?: BridgeToken[];
}): Promise<{ address: string; chain: string; token: BridgeToken; rail: ChainRail }> {
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
  return { address: result.address, chain: chosen.label, token, rail: chosen };
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
  const found = await depositAccount(input);
  const uri = paymentUri({ rail: found.rail, token: found.token, address: found.address, amount: input.amount });
  const qr = await writeAccountCode(uri, input.dir);
  return { uri, address: found.address, chain: found.chain, qr };
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

/**
 * Poll the bridge until a deposit row is a Received line.
 * `maxPolls` bounds a test. A live call waits up to fifteen minutes.
 */
export async function watchUntilReceived(input: {
  accountId: string;
  chain: string;
  token: string;
  amount?: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  maxPolls?: number;
}): Promise<string> {
  const chosen = rail(input.chain);
  if (!chosen) throw new Error("STOP: chain");
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait = input.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const polls = input.maxPolls ?? 180;
  const seen = new Set<string>();
  let line = "waiting";
  for (let i = 0; i < polls; i += 1) {
    const list = await recentDeposits(input.accountId, input.chain, fetchImpl);
    if (i === 0) {
      for (const row of list.deposits) seen.add(depositId(row));
    }
    line = freshLine(chosen.id, chosen.label, input.token, list.deposits, seen, input.amount);
    if (line.startsWith("Received")) return line;
    if (i + 1 < polls) await wait(5_000);
  }
  return line;
}

/** A bridge amount is a decimal string, or an atomic integer with `decimals`. */
function amountText(row: Record<string, unknown>): string | null {
  if (typeof row.amount === "string" && row.amount !== "") return row.amount;
  if (typeof row.amount !== "number" || !Number.isFinite(row.amount)) return null;
  const decimals = row.decimals;
  if (typeof decimals !== "number" || decimals < 0) return String(row.amount);
  const atomic = BigInt(Math.trunc(row.amount));
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

function depositId(row: Record<string, unknown>): string {
  if (typeof row.tx_hash === "string" && row.tx_hash) return row.tx_hash;
  if (typeof row.hash === "string" && row.hash) return row.hash;
  return `${amountText(row) ?? ""}|${String(row.from ?? row.sender ?? "")}|${String(row.created_at ?? "")}`;
}

function sameAmount(got: string, want: string): boolean {
  const norm = (value: string) => {
    if (!/^\d+(\.\d+)?$/.test(value)) return value;
    const [whole, frac = ""] = value.split(".");
    const trimmed = `${whole.replace(/^0+(?=\d)/, "")}.${frac.replace(/0+$/, "")}`;
    return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  };
  return norm(got) === norm(want);
}

/** A deposit that was not already listed when the code was shown, for this amount when one was asked. */
export function freshLine(
  chainId: string,
  chainLabel: string,
  token: string,
  deposits: Record<string, unknown>[],
  seen: ReadonlySet<string>,
  amount?: string,
): string {
  const row = deposits.find((item) => {
    if (seen.has(depositId(item))) return false;
    const text = amountText(item);
    if (text === null || !(typeof item.sender === "string" || typeof item.from === "string")) return false;
    return amount === undefined || amount === "" || sameAmount(text, amount);
  });
  return row ? watchLine(chainId, chainLabel, token, [row]) : "waiting";
}

/** Observed empty list is waiting. A deposit row is reported only from its own fields. */
export function watchLine(chainId: string, chainLabel: string, token: string, deposits: Record<string, unknown>[]): string {
  const row = deposits.find((item) => amountText(item) !== null && (typeof item.sender === "string" || typeof item.from === "string"));
  if (!row) return "waiting";
  const from = String(row.sender ?? row.from);
  const hash = typeof row.tx_hash === "string" ? row.tx_hash : typeof row.hash === "string" ? row.hash : "";
  const link = hash ? explorer(chainId, hash) : "";
  return `Received ${amountText(row)} ${token} on ${chainLabel} from ${from}.${link}`.trim();
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
