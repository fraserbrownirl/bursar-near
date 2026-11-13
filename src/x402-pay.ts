import { Mppx, evm } from "mppx/client";
import { askApprove } from "./agent.js";
import { ensureFloat, floatSigner, topUpFloat } from "./base-float.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, type ChainFacts } from "./decide.js";
import { append } from "./guard/ledger.js";
import { readPayeeMap } from "./payees.js";
import { MPP_LIMIT_ATOMIC } from "./mpp.js";
import { decodePaymentRequired, reviewX402 } from "./x402.js";

const EMPTY: ChainFacts = { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };

/** The body of the last paid x402 response, so the owner session can say what the API answered. */
export let lastX402Body = "";

/** JSON bodies print indented; anything else prints as-is. A 6 KB single line is unreadable in a real terminal. */
export function printableBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The Base transaction hash from an x402 settlement response, when the facilitator included one. */
export function settlementTx(header: string | null): string | null {
  if (!header) return null;
  try {
    const body = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { transaction?: string; txHash?: string };
    return body.transaction ?? body.txHash ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a 402, run the checks and the card, top up the Base float, sign
 * EIP-3009, and retry. Prints the API body. Returns 0 when the API accepts it.
 */
export async function payX402(url: string, accountId: string): Promise<number> {
  const first = await fetch(url, { headers: { accept: "application/json" } });
  const required = first.headers.get("payment-required");
  if (first.status !== 402 || !required) {
    process.stdout.write(first.status === 402 ? "STOP: no x402 payment-required\n" : `STOP: ${first.status} no 402\n`);
    return 1;
  }
  const review = reviewX402(decodePaymentRequired(required));
  if (review.stop || !review.accept) {
    process.stdout.write(`${review.stop ?? "STOP"}\n`);
    return 1;
  }
  const nowMs = Date.now();
  const chain = decide({
    receiver: review.accept.payTo,
    nowNs: BigInt(nowMs) * 1_000_000n,
    amount: review.accept.amount,
    token: "usdc",
    request: "",
    facts: EMPTY,
    payees: readPayeeMap(),
    blocklist: await loadBlocklist(review.accept.payTo),
  });
  if (chain.verdict === "block") {
    process.stdout.write(`STOP: ${chain.reasons[0] ?? "block"}\n`);
    return 1;
  }
  const { withinDemoCap } = await import("./swap-intent.js");
  if (!withinDemoCap(review.accept.amount)) {
    const yes = await askApprove(chain.reasons.length > 0 ? chain.reasons : ["new api"], review.card);
    if (!yes) {
      process.stdout.write("STOP\n");
      return 1;
    }
  }
  ensureFloat();
  await topUpFloat(accountId, BigInt(review.accept.amount));
  const display = Number(review.accept.amount) / 1_000_000;
  process.stdout.write(`Paying ${display} USDC to ${new URL(url).host}\n`);
  const mppx = Mppx.create({
    polyfill: false,
    methods: [evm({ account: floatSigner(), networks: [8453], maxAtomicAmount: MPP_LIMIT_ATOMIC })],
  });
  const prepared = await mppx.prepareRequest(url, { headers: { accept: "application/json" } }, { requirePayment: true });
  const paid = await prepared.payment.pay();
  lastX402Body = await paid.text();
  process.stdout.write(printableBody(lastX402Body) + "\n");
  const tx = settlementTx(paid.headers.get("payment-response"));
  append("settled", {
    recipient: review.accept.payTo,
    chain: "base",
    amount: review.accept.amount,
    verdict: "allow",
    transaction: tx ?? "",
    fee: "",
    url,
  });
  if (tx) process.stdout.write(`https://basescan.org/tx/${tx}\n`);
  return paid.ok ? 0 : 1;
}
