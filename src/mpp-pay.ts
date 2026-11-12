import { nearintents, Types } from "@defuse-protocol/nearintents-mpp-sdk/client";
import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import { Receipt } from "mppx";
import { Mppx } from "mppx/client";
import { NEAR_USDC } from "./assets.js";
import { askApprove } from "./agent.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, type ChainFacts } from "./decide.js";
import { checkQuoteInModel } from "./model-checks.js";
import { ACCOUNT_HEADER, assetsMatch, challengeLine, reviewMpp, type MppRequest } from "./mpp.js";
import { readPayeeMap } from "./payees.js";
import type { SignedQuote } from "./quote.js";
import { sendGuardedUsdc } from "./signer.js";

const EMPTY: ChainFacts = {
  codeHash: null,
  createdNs: null,
  outgoingCount: null,
  latestDeployNs: null,
  errors: {},
};

export type Paid = { stop: string | null; hash: string | null; card: string };

/**
 * Refund, quote, expiry, description, and the limit, then the in-model check,
 * `decide`, and the card. `send` runs only after a yes.
 */
export async function payMppChallenge(input: {
  accountId: string;
  request: MppRequest;
  expires?: string;
  quote: SignedQuote | null;
  nowMs: number;
  requireNearUsdc?: boolean;
  checkQuote?: (quote: SignedQuote) => Promise<string | null>;
  guard?: () => Promise<{ verdict: "allow" | "warn" | "block"; reasons: string[] }> | { verdict: "allow" | "warn" | "block"; reasons: string[] };
  approve?: (reasons: readonly string[], card: string) => Promise<boolean>;
  send?: (amount: string, depositAddress: string, memo: string | null) => Promise<string>;
}): Promise<Paid> {
  const reviewed = reviewMpp(input);
  if (reviewed.stop) return { stop: reviewed.stop, hash: null, card: reviewed.card };
  if (input.requireNearUsdc && !assetsMatch(NEAR_USDC, input.request.currency)) {
    return { stop: "STOP: currency", hash: null, card: reviewed.card };
  }
  const quote = input.quote;
  if (!quote) return { stop: "STOP: quote", hash: null, card: reviewed.card };
  if (input.checkQuote) {
    const modelStop = await input.checkQuote(quote);
    if (modelStop) return { stop: modelStop, hash: null, card: reviewed.card };
  }
  const chain = (await input.guard?.()) ?? { verdict: "allow" as const, reasons: [] as string[] };
  if (chain.verdict === "block") {
    return { stop: `STOP: ${chain.reasons[0] ?? "block"}`, hash: null, card: reviewed.card };
  }
  const approve = input.approve ?? askApprove;
  const yes = await approve(chain.reasons, reviewed.card);
  if (!yes) return { stop: "STOP", hash: null, card: reviewed.card };
  const memo = input.request.methodDetails.depositMemo ?? null;
  const send = input.send ?? ((amount, depositAddress, depositMemo) => sendGuardedUsdc({
    accountId: input.accountId,
    depositAddress,
    amount,
    memo: depositMemo,
  }));
  const hash = await send(input.request.amount, input.request.recipient, memo);
  return { stop: null, hash, card: reviewed.card };
}

/** The signed quote 1Click stored for this deposit address. */
export async function quoteBehind(depositAddress: string): Promise<SignedQuote> {
  const status = await OneClickService.getExecutionStatus(depositAddress);
  return status.quoteResponse as SignedQuote;
}

/**
 * `sendDeposit` for `nearintents.charge`. Returns the NEAR transaction hash,
 * or throws a STOP line before the key is used.
 */
export async function sendDeposit(input: {
  accountId: string;
  challenge: { expires?: string };
  request: MppRequest;
  nowMs?: number;
}): Promise<string> {
  const nowMs = input.nowMs ?? Date.now();
  process.stdout.write(challengeLine(input.request) + "\n");
  let quote: SignedQuote | null = null;
  try {
    quote = await quoteBehind(input.request.recipient);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.startsWith("STOP:") ? message : "STOP: quote");
  }
  const { deliverFromIntents } = await import("./mpp-deliver.js");
  return deliverFromIntents({
    accountId: input.accountId,
    request: input.request,
    expires: input.challenge.expires,
    merchantQuote: quote,
    nowMs,
  });
}

/** Loads the blocklist for a live guard. Tests pass their own `guard` instead. */
export async function liveGuard(receiver: string, amount: string, nowMs: number): Promise<{
  verdict: "allow" | "warn" | "block";
  reasons: string[];
}> {
  return decide({
    receiver,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount,
    token: NEAR_USDC,
    request: "",
    facts: EMPTY,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(receiver),
  });
}

/** Pays one MPP URL. The credential is the NEAR transaction hash from `sendDeposit`. */
export async function payUrl(url: string, accountId: string): Promise<number> {
  try {
    return await payUrlOnce(url, accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write((message.startsWith("STOP") ? message : `STOP: ${message}`) + "\n");
    return 1;
  }
}

async function payUrlOnce(url: string, accountId: string): Promise<number> {
  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      nearintents.charge({
        sendDeposit: ({ challenge, request }) => sendDeposit({ accountId, challenge, request }),
      }),
    ],
  });
  const response = await mppx.fetch(url, { headers: { [ACCOUNT_HEADER]: accountId } });
  const body = await response.text();
  process.stdout.write(`HTTP ${response.status}\n${body}\n`);
  if (!response.ok) return 1;
  const receipt = Receipt.fromResponse(response) as Types.NearIntentsReceipt;
  process.stdout.write(`https://nearblocks.io/txns/${receipt.reference}\n`);
  return 0;
}
