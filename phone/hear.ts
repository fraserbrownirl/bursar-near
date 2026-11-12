import { isNearAccount } from "../src/account.js";
import { decide, type ChainFacts } from "../src/decide.js";
import { injectionReason, scanForInstructions } from "../src/guard/injection.js";

export type Heard =
  | { screen: "ask"; ask: string; to?: string }
  | { screen: "stop"; reason: string }
  | { screen: "card"; to: string; human: string; verdict: "allow" | "warn" | "block"; reason: string };

const unread: ChainFacts = {
  codeHash: null,
  createdNs: null,
  outgoingCount: null,
  latestDeployNs: null,
  errors: {
    codeHash: "not read on this phone",
    created: "not read on this phone",
    outgoing: "not read on this phone",
    deploy: "not read on this phone",
  },
};

function splitTurn(text: string): { owner: string; content: string } {
  const lines = text.split("\n");
  if (lines.length > 1) return { owner: (lines[0] ?? "").trim(), content: lines.slice(1).join("\n").trim() };
  return { owner: text.trim(), content: "" };
}

function contentOf(content: string): string | null {
  if (content.trim() === "") return null;
  const findings = scanForInstructions([{ where: "pasted text", text: content }]);
  return findings.length > 0 ? injectionReason(findings) : null;
}

function atomic(human: string): string | null {
  const [whole, frac = ""] = human.split(".");
  if (!/^\d+$/.test(whole ?? "") || !/^\d*$/.test(frac)) return null;
  const digits = (frac + "000000").slice(0, 6);
  return (BigInt(whole) * 1_000_000n + BigInt(digits || "0")).toString();
}

function accountIn(text: string): string | null {
  const evm = text.match(/0x[0-9a-fA-F]{40}/);
  if (evm) return evm[0];
  const named = text.match(/\b([a-z0-9][a-z0-9._-]{0,62}\.near)\b/);
  if (named?.[1] && isNearAccount(named[1])) return named[1];
  const implicit = text.match(/\b([0-9a-f]{64})\b/);
  if (implicit?.[1]) return implicit[1];
  const sol = text.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
  return sol?.[1] ?? null;
}

function amountIn(text: string): string | null {
  const marked = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*USDC\b/i);
  if (marked?.[1]) return marked[1];
  const paid = text.match(/\bpay\s+([0-9]+(?:\.[0-9]+)?)\b/i);
  return paid?.[1] ?? null;
}

function stated(owner: string): { to: string; human: string; amount: string } | null {
  const human = amountIn(owner);
  const to = accountIn(owner);
  if (!human || !to) return null;
  const amount = atomic(human);
  if (!amount) return null;
  return { to, human, amount };
}

/** Owner view of one typed turn. A paste is every line after the first. */
export function hear(text: string): Heard {
  const { owner, content } = splitTurn(text);
  const stopped = contentOf(content);
  if (stopped) return { screen: "stop", reason: stopped };
  const payment = stated(owner);
  if (!payment) {
    const to = accountIn(owner);
    if (to) return { screen: "ask", ask: "How much?", to };
    return { screen: "ask", ask: "Who should I pay, and how much?" };
  }
  return card(payment.to, payment.human, payment.amount);
}

function card(to: string, human: string, amount: string): Heard {
  const result = decide({
    receiver: to,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount,
    token: "USDC",
    request: "",
    facts: unread,
    payees: {},
    blocklist: { path: "phone", accounts: {}, missing: false },
  });
  if (result.verdict === "block") return { screen: "stop", reason: result.reasons[0] ?? "block" };
  return {
    screen: "card",
    to,
    human,
    verdict: result.verdict,
    reason: result.reasons[0] ?? "",
  };
}

function fromAtomic6(atomic: string): string | null {
  if (!/^\d+$/.test(atomic)) return null;
  const value = BigInt(atomic);
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

/** JavaScriptCore has no URLSearchParams. The phone scan runs there. */
function queryValue(text: string, key: string): string | null {
  const index = text.indexOf("?");
  if (index < 0) return null;
  for (const part of text.slice(index + 1).split("&")) {
    const eq = part.indexOf("=");
    const name = eq >= 0 ? part.slice(0, eq) : part;
    if (name === key) return eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : "";
  }
  return null;
}

/** A payment code: a bare account, `pay <amount> USDC to <account>`, or a receive URI. */
function codePayment(text: string): { to: string; human: string | null } | null {
  const trimmed = text.trim();
  const ethereum = trimmed.match(/^ethereum:(0x[0-9a-fA-F]{40})(?:@\d+\/transfer\?|$|\?)/i);
  if (ethereum) {
    const to = queryValue(trimmed, "address") ?? ethereum[1] ?? null;
    const atomic = queryValue(trimmed, "uint256");
    return to ? { to, human: atomic ? fromAtomic6(atomic) : null } : null;
  }
  const solana = trimmed.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?|$)/);
  if (solana?.[1]) return { to: solana[1], human: queryValue(trimmed, "amount") };
  const bitcoin = trimmed.match(/^bitcoin:(bc1[a-z0-9]+)(?:\?|$)/);
  if (bitcoin?.[1]) return { to: bitcoin[1], human: queryValue(trimmed, "amount") };
  const near = trimmed.match(/^near:([a-z0-9._-]+|0x[0-9a-fA-F]{40}|[0-9a-f]{64})(?:\?|$)/);
  if (near?.[1]) {
    const atomic = queryValue(trimmed, "amount");
    return { to: near[1], human: atomic ? fromAtomic6(atomic) : null };
  }
  const to = accountIn(trimmed);
  return to ? { to, human: amountIn(trimmed) } : null;
}

/** A barcode is merchant text. A plain account or a payment in it is kept. The rest is scanned. */
export function scan(text: string): Heard {
  const found = codePayment(text);
  const to = found?.to ?? null;
  const human = found?.human ?? null;
  let rest = text;
  if (to) rest = rest.replace(to, " ");
  if (human) rest = rest.replace(human, " ");
  rest = rest.replace(/\b(pay|send|usdc|to|ethereum|solana|bitcoin|near|transfer|address|amount)\b/gi, " ");
  const findings = scanForInstructions([{ where: "code", text: rest }]);
  if (findings.length > 0) return { screen: "stop", reason: injectionReason(findings) };
  if (to && human) {
    const amount = atomic(human);
    if (amount) return card(to, human, amount);
  }
  if (to) return { screen: "ask", ask: "How much?", to };
  return { screen: "ask", ask: "Who should I pay, and how much?" };
}
