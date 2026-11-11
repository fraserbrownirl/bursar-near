import { execFileSync } from "node:child_process";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NEAR_USDC, resolveAsset, rowsFor } from "./assets.js";
import { checkIntentInModel, checkQuoteInModel } from "./model-checks.js";
import { referenceUi } from "./model.js";
import { settle } from "./pay.js";
import { secretFromKeychain, signerFromSecret } from "./signer.js";
import { BASE_USDC, needsTopUp, topUpChunk, TOP_UP_ATOMIC } from "./x402.js";

const SERVICE = "bursar-base-float";
const USDC_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

/** The float address, or null when no key has been saved. The secret is not returned. */
export function floatAddress(): string | null {
  try {
    const listed = execFileSync("security", ["find-generic-password", "-s", SERVICE], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const account = listed.match(/"acct"<blob>="(0x[0-9a-fA-F]{40})"/)?.[1];
    return account ?? null;
  } catch {
    return null;
  }
}

function floatKey(): `0x${string}` {
  const raw = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-w"], { encoding: "utf8" }).trim();
  if (!raw.startsWith("0x")) throw new Error("STOP: base float key");
  return raw as `0x${string}`;
}

/** Creates the Base key in the Keychain when it is missing. The key is not printed. */
export function ensureFloat(): string {
  const existing = floatAddress();
  if (existing) return existing;
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  execFileSync("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", address, "-w", privateKey]);
  return address;
}

export function floatSigner() {
  return privateKeyToAccount(floatKey());
}

export async function floatBalance(address: string): Promise<bigint> {
  return client.readContract({
    address: BASE_USDC,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
}

export async function intentsUsdc(accountId: string): Promise<bigint> {
  const body = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "b",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "intents.near",
        method_name: "mt_balance_of",
        args_base64: Buffer.from(JSON.stringify({
          account_id: accountId,
          token_id: `nep141:${NEAR_USDC}`,
        })).toString("base64"),
      },
    }),
  });
  const parsed = await body.json() as { result?: { result?: number[] } };
  const text = Buffer.from(parsed.result?.result ?? []).toString("utf8").replaceAll("\"", "");
  return text ? BigInt(text) : 0n;
}

export async function balanceReport(accountId: string): Promise<string> {
  const intents = await intentsUsdc(accountId);
  const address = floatAddress();
  const base = address ? await floatBalance(address) : null;
  const baseLine = base === null ? "Base float not created" : `Base float ${referenceUi(base.toString(), 6)} USDC`;
  return `Intents ${referenceUi(intents.toString(), 6)} USDC\n${baseLine}`;
}

/**
 * Sends 1 USDC from Intents to the float when the float is short and 1 USDC is
 * above the quote's minimum. Returns the settlement line, or null when no top-up was needed.
 */
export async function topUpFloat(accountId: string, paymentAtomic: bigint): Promise<string | null> {
  const address = ensureFloat();
  const balance = await floatBalance(address);
  if (!needsTopUp(balance, paymentAtomic)) return null;
  if (await intentsUsdc(accountId) < TOP_UP_ATOMIC) {
    throw new Error(`STOP: Intents balance is under 1 USDC`);
  }
  const rows = await rowsFor("USDC", "base");
  const dest = resolveAsset(rows, "USDC", "base");
  if ("ask" in dest) throw new Error(`STOP: ${dest.ask}`);
  const nowMs = Date.now();
  const request = {
    recipient: address,
    refundTo: accountId,
    amount: TOP_UP_ATOMIC.toString(),
    originAsset: NEAR_USDC,
    destinationAsset: dest.assetId,
    deadline: new Date(nowMs + 4 * 60 * 1000).toISOString(),
    minAmountOut: "0",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
  };
  const quote = await OneClickService.getQuote({
    dry: false,
    swapType: "EXACT_INPUT",
    depositType: "INTENTS",
    slippageTolerance: 100,
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    recipient: address,
    recipientType: "DESTINATION_CHAIN",
    refundTo: accountId,
    refundType: "INTENTS",
    deadline: request.deadline,
  } as never);
  const chunk = topUpChunk((quote.quote as { minAmountIn?: string }).minAmountIn);
  if (!chunk) throw new Error("STOP: 1 USDC is not above the route minimum");
  const nowSec = Math.floor(nowMs / 1000);
  const checked = await checkQuoteInModel(quote as never, request, nowSec);
  process.stdout.write(checked.lines + "\n");
  if (checked.stop) throw new Error(checked.stop);
  const signer = signerFromSecret(secretFromKeychain(accountId), accountId, quote as never, () => nowMs);
  const line = await settle({
    quote: quote as never,
    request,
    accountId,
    nowSec,
    signer,
    checkIntent: async (generated) => {
      const decoded = await checkIntentInModel(generated, accountId);
      process.stdout.write(decoded.lines + "\n");
      return decoded.stop;
    },
    generateIntent: async (depositAddress, signerId) => OneClickService.generateIntent({
      type: "swap_transfer",
      standard: "nep413",
      signerId,
      depositAddress,
    } as never) as never,
    submitIntent: async (signed) => OneClickService.submitIntent({ type: "swap_transfer", signedData: signed } as never),
  });
  if (line !== "submitted") throw new Error(line);
  process.stdout.write(`top-up 1 USDC toward ${address}\n`);
  return quote.quote.depositAddress ?? null;
}
