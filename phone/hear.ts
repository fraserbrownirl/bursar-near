import { decide, type ChainFacts } from "../src/decide.js";
import { injectionReason, scanForInstructions } from "../src/guard/injection.js";

export type Heard =
  | { screen: "ask"; ask: string }
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

function stated(owner: string): { to: string; human: string; amount: string } | null {
  const match = owner.match(/\bpay\s+([0-9]+(?:\.[0-9]+)?)\s+USDC\s+to\s+([a-z0-9._-]+)/i);
  if (!match) return null;
  const human = match[1] ?? "";
  const to = match[2] ?? "";
  const [whole, frac = ""] = human.split(".");
  if (!/^\d+$/.test(whole ?? "") || !/^\d*$/.test(frac)) return null;
  const digits = (frac + "000000").slice(0, 6);
  const amount = (BigInt(whole) * 1_000_000n + BigInt(digits || "0")).toString();
  return { to, human, amount };
}

/** Owner view of one typed turn. A paste is every line after the first. */
export function hear(text: string): Heard {
  const { owner, content } = splitTurn(text);
  const stopped = contentOf(content);
  if (stopped) return { screen: "stop", reason: stopped };
  const payment = stated(owner);
  if (!payment) {
    if (/\b[a-z0-9._-]+\.near\b/.test(owner) && !/\d/.test(owner)) return { screen: "ask", ask: "How much?" };
    return { screen: "ask", ask: "Who should I pay, and how much?" };
  }
  const result = decide({
    receiver: payment.to,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount: payment.amount,
    token: "USDC",
    request: "",
    facts: unread,
    payees: {},
    blocklist: { path: "phone", accounts: {}, missing: false },
  });
  if (result.verdict === "block") return { screen: "stop", reason: result.reasons[0] ?? "block" };
  return {
    screen: "card",
    to: payment.to,
    human: payment.human,
    verdict: result.verdict,
    reason: result.reasons[0] ?? "",
  };
}
