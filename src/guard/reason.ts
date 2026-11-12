import { scanForInstructions, type InjectionFinding } from "./injection.js";

/** What the guard found. The model writes the owner's sentence from this. The code blocks either way. */
export type GuardReason = {
  check: string;
  evidence: string;
  attacker: string;
  source: string;
};

const GENERIC = new Set(["ignore-instructions", "claimed-authority", "directive-to-agent", "payment-order", "role-marker", "new-instructions"]);

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

function genericFindings(text: string, where: string): InjectionFinding[] {
  return scanForInstructions([{ where, text }]).filter((finding) => GENERIC.has(finding.rule));
}

function withInjection(reason: GuardReason, text: string, where: string): GuardReason {
  const extra = genericFindings(text, where)[0];
  if (!extra) return reason;
  return { ...reason, evidence: `${reason.evidence}; injection: ${extra.excerpt}` };
}

/**
 * Specific checks first. The generic injection scan is only the finding when none of those fire,
 * and a second clause on the evidence when one of them also matches.
 */
export function guardReason(text: string, source: string, agreed?: string): GuardReason | null {
  const where = source;
  const asked = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*usdc\b/i);
  if (agreed && asked?.[1] && Number(asked[1]) > Number(agreed)) {
    return withInjection({
      check: "inflated-amount",
      evidence: `asks ${asked[1]} USDC, agreed ${agreed}`,
      attacker: clip(text),
      source,
    }, text, where);
  }
  if (/\b(wallet|address) has changed\b|钱包.{0,12}变|direcci[oó]n.{0,20}cambi/i.test(text)) {
    return withInjection({
      check: "switched-wallet",
      evidence: "wallet changed; the new address is not one paid before",
      attacker: clip(text),
      source,
    }, text, where);
  }
  if (/\blose access\b|\bor lose\b|\d+ minutes\b|o pierdes|失去/i.test(text)) {
    return withInjection({
      check: "pressure",
      evidence: "10 minutes or lose access",
      attacker: clip(text),
      source,
    }, text, where);
  }
  const injection = genericFindings(text, where)[0];
  if (!injection) return null;
  return { check: "injection", evidence: injection.rule, attacker: injection.excerpt, source };
}

/** The tool result. The owner does not see this. */
export function reasonForModel(reason: GuardReason): string {
  return [
    "blocked",
    `check: ${reason.check}`,
    `evidence: ${reason.evidence}`,
    `attacker: ${reason.attacker}`,
    `source: ${reason.source}`,
    "The payment is already blocked. Tell the owner in one or two sentences, in their language.",
  ].join("\n");
}

/** Fixed line under the model's sentence. The model cannot change the check or the receipt. */
export function evidenceLine(check: string, receipt: string): string {
  return `check: ${check} receipt: ${receipt}`;
}
