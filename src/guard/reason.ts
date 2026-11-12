import { scanForInstructions, type InjectionFinding } from "./injection.js";

/** What the guard found. `sentence` is the exact line the English owner sees. */
export type GuardReason = {
  check: string;
  evidence: string;
  attacker: string;
  source: string;
  sentence: string;
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

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Where the hostile text was found, in the words the owner sentence uses. */
export function placeOf(source: string): string {
  if (source === "merchant") return "402";
  if (source === "QR code") return "QR";
  return source;
}

export function accountIn(text: string): string {
  return text.match(/0x[a-fA-F0-9]{40}|[a-z0-9][a-z0-9._-]*\.near/i)?.[0] ?? "";
}

export function injectionSentence(source: string, text: string): string {
  return `Stopped. The ${placeOf(source)} says "${oneLine(text)}".`;
}

export function inflatedSentence(source: string, asked: string, agreed: string): string {
  return `Stopped. The ${placeOf(source)} asks for ${asked} USDC, and the agreed amount is ${agreed} USDC.`;
}

export function switchedSentence(source: string, next: string, previous: string): string {
  const prior = previous ? `${previous}, the account that was paid before` : "an account that was paid before";
  return `Stopped. The ${placeOf(source)} says the wallet has changed to ${next || "a new account"}, which is not ${prior}.`;
}

export function pressureSentence(source: string, text: string): string {
  return `Stopped. The ${placeOf(source)} says ${oneLine(text)}.`;
}

export function lookalikeSentence(typed: string, savedAddress: string, savedName: string): string {
  return `Stopped. ${typed} resembles ${savedAddress}, saved as ${savedName}.`;
}

export function limitSentence(who: string, asked: string, limit: string): string {
  return `Stopped. The ${who} asks for ${asked} USDC, and the limit is ${limit} USDC.`;
}

export function standingSentence(account: string): string {
  return `Stopped. The chat tries to install ${account} as a standing payee, and a standing payee is not set in the chat.`;
}

export function wrongReceiveSentence(chain: string, deposit: string | null): string {
  if (deposit) return `Stopped. The Intents account is not the ${chain} deposit address ${deposit}.`;
  return `Stopped. The Intents account is not the ${chain} deposit address, and the deposit lookup failed.`;
}

export function quoteSentence(recipient: string): string {
  return `Stopped. The quote signature does not verify, and the recipient was changed to ${recipient}.`;
}

export function extraIntentSentence(): string {
  return "Stopped. The intent has 2 intents, and the extra one is add_public_key.";
}

export function deadlineSentence(intentDeadline: string, signedDeadline: string): string {
  return `Stopped. The intent deadline ${intentDeadline} is later than the signed quote deadline ${signedDeadline}.`;
}

export function ledgerSentence(found: string): string {
  const line = found.match(/STOP: ledger line (\d+): ([^\n]+)/);
  const problem = line ? `ledger line ${line[1]} ${line[2].trim()}` : "ledger check failed";
  return /does not match/.test(found)
    ? `Stopped. The ${problem}, and the anchor does not match a verified head.`
    : `Stopped. The ${problem}.`;
}

/** Numbers, accounts, addresses, dates, and snake_case names. A translation must keep each one whole. */
export function factTokens(sentence: string): string[] {
  const tokens: string[] = [];
  const take = (re: RegExp) => {
    for (const match of sentence.matchAll(re)) tokens.push(match[0]);
  };
  take(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g);
  take(/0x[a-fA-F0-9]{40}|[a-z0-9][a-z0-9._-]*\.near/gi);
  take(/\b[a-z]+(?:_[a-z]+)+\b/g);
  let rest = sentence;
  for (const token of tokens) rest = rest.split(token).join(" ");
  for (const match of rest.matchAll(/\d+(?:\.\d+)?/g)) tokens.push(match[0]);
  return [...new Set(tokens)];
}

function tokenPresent(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = /^\d/.test(token)
    ? new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`)
    : new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
  return re.test(text);
}

/** True when every number, name, account, and address survived unchanged. */
export function translationKeeps(original: string, translated: string): boolean {
  const tokens = factTokens(original);
  return tokens.length > 0 && tokens.every((token) => tokenPresent(translated, token));
}

export function ownerLanguage(text: string): "en" | "es" | "zh" {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[áéíóúñ¿¡]|\b(paga|factura|ignora|l[ií]mites|limites)\b/i.test(text)) return "es";
  return "en";
}

/**
 * Specific checks first. The generic injection scan is only the finding when none of those fire,
 * and a second clause on the evidence when one of them also matches.
 */
export function guardReason(text: string, source: string, agreed?: string, previous?: string): GuardReason | null {
  const where = source;
  const asked = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*usdc\b/i);
  if (agreed && asked?.[1] && Number(asked[1]) > Number(agreed)) {
    return withInjection({
      check: "inflated-amount",
      evidence: `asks ${asked[1]} USDC, agreed ${agreed}`,
      attacker: clip(text),
      source,
      sentence: inflatedSentence(source, asked[1], agreed),
    }, text, where);
  }
  if (/\b(wallet|address) has changed\b|钱包.{0,12}变|direcci[oó]n.{0,20}cambi/i.test(text)) {
    return withInjection({
      check: "switched-wallet",
      evidence: "wallet changed; the new address is not one paid before",
      attacker: clip(text),
      source,
      sentence: switchedSentence(source, accountIn(text), previous ?? ""),
    }, text, where);
  }
  if (/\blose access\b|\bor lose\b|\d+ minutes\b|o pierdes|失去/i.test(text)) {
    return withInjection({
      check: "pressure",
      evidence: "10 minutes or lose access",
      attacker: clip(text),
      source,
      sentence: pressureSentence(source, text),
    }, text, where);
  }
  const injection = genericFindings(text, where)[0];
  if (!injection) return null;
  return { check: "injection", evidence: injection.rule, attacker: injection.excerpt, source, sentence: injectionSentence(source, text) };
}

/** The tool result. English is the guard sentence. Any other language is that sentence plus a translation instruction. */
export function reasonForModel(reason: GuardReason, language: "en" | "es" | "zh" = "en"): string {
  const head = [
    "blocked",
    `check: ${reason.check}`,
    `evidence: ${reason.evidence}`,
    `attacker: ${reason.attacker}`,
    `source: ${reason.source}`,
    reason.sentence,
  ];
  if (language === "en") return head.join("\n");
  const which = language === "zh" ? "Chinese" : "Spanish";
  return [...head, `Translate the sentence above into ${which}. Do not add or change any number, name, account, or address.`].join("\n");
}

/** Fixed line under the model's sentence. The model cannot change the check or the receipt. */
export function evidenceLine(check: string, receipt: string): string {
  return `check: ${check} receipt: ${receipt}`;
}

/** A token longer than the width breaks at / ? & @ =, never inside a word. */
function fitToken(word: string, width: number): string[] {
  if (word.length <= width) return [word];
  const out: string[] = [];
  let rest = word;
  while (rest.length > width) {
    const window = rest.slice(0, width);
    const cut = Math.max(window.lastIndexOf("/"), window.lastIndexOf("?"), window.lastIndexOf("&"), window.lastIndexOf("@"), window.lastIndexOf("="));
    if (cut <= 0) {
      out.push(rest);
      return out;
    }
    out.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  if (rest) out.push(rest);
  return out;
}

function columnWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide = (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Break on spaces. A word is not split. A long address breaks only at its punctuation. Wide characters take two columns. */
export function wrapWords(text: string, width: number): string {
  const limit = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  const push = (piece: string) => {
    if (!line) line = piece;
    else if (columnWidth(line) + 1 + columnWidth(piece) <= limit) line = `${line} ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  };
  for (const word of text.split(/\s+/).filter((item) => item)) {
    for (const piece of fitToken(word, limit)) push(piece);
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function terminalWidth(): number {
  const columns = process.stdout.columns;
  return columns && columns >= 20 ? columns : 96;
}
