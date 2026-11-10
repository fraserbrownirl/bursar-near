import { isNearAccount } from "./account.js";
import { readBlocklist, trustedReporters, type BlocklistReport } from "./blocklist.js";
import { scanForInstructions, stringsOf, injectionReason } from "./guard/injection.js";
import { append, readLedger } from "./guard/ledger.js";
import { knownHostile, lookalikeOf, remember } from "./guard/memory.js";
import { readPayeeMap } from "./payees.js";
import { dir } from "./store.js";

/** `code_hash` of an account with no contract. Observed on frol.near, and the view_account example. */
export const EMPTY_CODE_HASH = "11111111111111111111111111111111";

/** Warn when age or the latest code deploy is under this many nanoseconds. */
export const RECENT_NS = 14n * 24n * 60n * 60n * 1_000_000_000n;

export const NEAR_RPC = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";
export const NEARBLOCKS = process.env.NEARBLOCKS_URL ?? "https://api.nearblocks.io/v1/account";

export type ChainFacts = {
  codeHash: string | null;
  createdNs: string | null;
  outgoingCount: string | null;
  latestDeployNs: string | null;
  errors: {
    codeHash?: string;
    created?: string;
    outgoing?: string;
    deploy?: string;
  };
};

export type CheckInput = {
  receiver: string;
  nowNs: bigint;
  amount?: string;
  token?: string;
  request?: string;
  facts: ChainFacts;
  payees?: Readonly<Record<string, string>>;
  blocklist?: { path: string; accounts: Readonly<Record<string, readonly BlocklistReport[]>>; missing: boolean };
};

export type Signal = {
  name: string;
  value: string;
  source: string;
  by: string;
  effect: "block" | "warn" | "evidence";
  reason: string | null;
};

export type CheckResult = {
  verdict: "allow" | "warn" | "block";
  reasons: string[];
  signals: Signal[];
  ledgerHash: string;
};

function days(ageNs: bigint): bigint {
  return ageNs / (24n * 60n * 60n * 1_000_000_000n);
}

function accountUrl(receiver: string, suffix = ""): string {
  return `GET ${NEARBLOCKS}/${receiver}${suffix}`;
}

function priorPayments(receiver: string): number {
  return readLedger().filter((entry) => {
    const recorded = entry.data.receiver;
    if (recorded !== receiver) return false;
    return entry.kind === "settled" || entry.data.verdict === "allow";
  }).length;
}

function injectionSources(request: string): { where: string; text: string }[] {
  try {
    const parsed: unknown = JSON.parse(request);
    if (parsed && typeof parsed === "object") return stringsOf(parsed, "request");
  } catch {
    // Plain text. Scan it as one source.
  }
  return [{ where: "request", text: request }];
}

/**
 * Decides allow, warn, or block for one receiver.
 * Reads the local ledger, campaign memory, and payees. Appends the decision.
 * Chain facts are passed in so tests never call the network.
 */
export function decide(input: CheckInput): CheckResult {
  const payees = input.payees ?? readPayeeMap();
  const blocklist = input.blocklist ?? readBlocklist();
  const signals: Signal[] = [];

  const hostile = knownHostile(input.receiver, input.receiver);
  signals.push({
    name: "campaign-memory",
    value: hostile ? `${hostile.kind} ${hostile.value}` : "none",
    source: `memory.json in ${dir()}`,
    by: "campaign memory",
    effect: hostile ? "block" : "evidence",
    reason: hostile
      ? `known hostile ${hostile.kind} (${hostile.reason}, first seen ${hostile.firstSeen.slice(0, 10)})`
      : null,
  });

  const imitated = lookalikeOf(input.receiver, payees);
  signals.push({
    name: "look-alike",
    value: imitated ? imitated.address : "none",
    source: `payees.json in ${dir()}, edit distance <= 2`,
    by: "campaign memory",
    effect: imitated ? "block" : "evidence",
    reason: imitated ? `recipient is a look-alike of payee ${imitated.name}` : null,
  });

  const request = input.request?.trim() ?? "";
  const findings = request === "" ? [] : scanForInstructions(injectionSources(request));
  signals.push({
    name: "injection",
    value: findings[0]?.excerpt ?? (request === "" ? "no request text" : "none"),
    source: request === "" ? "command --request omitted" : "command --request",
    by: "injection scan",
    effect: findings.length > 0 ? "block" : "evidence",
    reason: findings.length > 0 ? injectionReason(findings) : null,
  });

  const listed = blocklist.accounts[input.receiver] ?? [];
  const trusted = new Set(trustedReporters());
  if (blocklist.missing) {
    signals.push({
      name: "blocklist",
      value: "file missing",
      source: blocklist.path,
      by: "blocklist",
      effect: "block",
      reason: "blocklist file missing",
    });
  } else if (listed.length === 0) {
    signals.push({
      name: "blocklist",
      value: "not listed",
      source: `${blocklist.path} get(${input.receiver})`,
      by: "blocklist",
      effect: "evidence",
      reason: null,
    });
  } else {
    for (const report of listed) {
      const fromTrusted = report.reporter !== "" && trusted.has(report.reporter);
      signals.push({
        name: "blocklist",
        value: `${report.reporter} ${report.evidenceHash}`,
        source: `${blocklist.path} get(${input.receiver})`,
        by: "blocklist",
        effect: fromTrusted ? "block" : "evidence",
        reason: fromTrusted ? `reported by ${report.reporter}, evidence ${report.evidenceHash}` : null,
      });
    }
  }

  if (!isNearAccount(input.receiver)) {
    signals.push({
      name: "chain",
      value: "not a NEAR account: on-chain age and activity not checked",
      source: "account id shape",
      by: "local",
      effect: "evidence",
      reason: null,
    });
  } else if (input.facts.errors.codeHash || input.facts.codeHash === null) {
    signals.push({
      name: "contract",
      value: input.facts.errors.codeHash ?? "no code_hash",
      source: `POST ${NEAR_RPC} view_account ${input.receiver} code_hash`,
      by: "NEAR RPC",
      effect: "warn",
      reason: "account code hash unavailable",
    });
  } else {
    const contract = input.facts.codeHash !== EMPTY_CODE_HASH;
    signals.push({
      name: "contract",
      value: contract ? input.facts.codeHash : `${EMPTY_CODE_HASH} (no contract)`,
      source: `POST ${NEAR_RPC} view_account ${input.receiver} code_hash`,
      by: "NEAR RPC",
      effect: "evidence",
      reason: null,
    });
  }

  if (isNearAccount(input.receiver) && input.facts.errors.created) {
    signals.push({
      name: "account-age",
      value: input.facts.errors.created,
      source: accountUrl(input.receiver),
      by: "NearBlocks",
      effect: "warn",
      reason: "account age unavailable",
    });
  } else if (isNearAccount(input.receiver) && input.facts.createdNs === null) {
    signals.push({
      name: "account-age",
      value: "no creation record",
      source: `${accountUrl(input.receiver)} created.block_timestamp`,
      by: "NearBlocks",
      effect: "warn",
      reason: "no creation record for the account",
    });
  } else if (isNearAccount(input.receiver) && input.facts.createdNs !== null) {
    const age = input.nowNs - BigInt(input.facts.createdNs);
    const young = age < RECENT_NS;
    signals.push({
      name: "account-age",
      value: `${days(age)} days (created.block_timestamp = ${input.facts.createdNs})`,
      source: `${accountUrl(input.receiver)} created.block_timestamp`,
      by: "NearBlocks",
      effect: young ? "warn" : "evidence",
      reason: young ? "account age is under 14 days" : null,
    });
  }

  const codeKnown = isNearAccount(input.receiver) && input.facts.codeHash !== null && !input.facts.errors.codeHash;
  const isContract = codeKnown && input.facts.codeHash !== EMPTY_CODE_HASH;
  if (!isNearAccount(input.receiver)) {
    // The chain line above is the only on-chain evidence for this receiver.
  } else if (!codeKnown) {
    signals.push({
      name: "code-change",
      value: input.facts.errors.codeHash ?? "no code_hash",
      source: `${accountUrl(input.receiver, "/contract/deployments")} block_timestamp`,
      by: "NearBlocks",
      effect: "warn",
      reason: "account code hash unavailable",
    });
  } else if (!isContract) {
    signals.push({
      name: "code-change",
      value: "not a contract",
      source: `${accountUrl(input.receiver, "/contract/deployments")} block_timestamp`,
      by: "NearBlocks",
      effect: "evidence",
      reason: null,
    });
  } else if (input.facts.errors.deploy) {
    signals.push({
      name: "code-change",
      value: input.facts.errors.deploy,
      source: `${accountUrl(input.receiver, "/contract/deployments")} block_timestamp`,
      by: "NearBlocks",
      effect: "warn",
      reason: "contract deployment history unavailable",
    });
  } else if (input.facts.latestDeployNs === null) {
    signals.push({
      name: "code-change",
      value: "no deployment record",
      source: `${accountUrl(input.receiver, "/contract/deployments")} block_timestamp`,
      by: "NearBlocks",
      effect: "warn",
      reason: "contract has no deployment record",
    });
  } else {
    const age = input.nowNs - BigInt(input.facts.latestDeployNs);
    const recent = age < RECENT_NS;
    signals.push({
      name: "code-change",
      value: `${days(age)} days (block_timestamp = ${input.facts.latestDeployNs})`,
      source: `${accountUrl(input.receiver, "/contract/deployments")} block_timestamp`,
      by: "NearBlocks",
      effect: recent ? "warn" : "evidence",
      reason: recent ? "contract code changed within 14 days" : null,
    });
  }

  if (!isNearAccount(input.receiver)) {
    // Activity is part of the chain line above.
  } else if (input.facts.errors.outgoing || input.facts.outgoingCount === null) {
    signals.push({
      name: "activity",
      value: input.facts.errors.outgoing ?? "no count",
      source: `${accountUrl(input.receiver, "/txns-only/count")}?from=${input.receiver} txns[0].count`,
      by: "NearBlocks",
      effect: "warn",
      reason: "outgoing activity unavailable",
    });
  } else {
    signals.push({
      name: "activity",
      value: `${input.facts.outgoingCount} outgoing`,
      source: `${accountUrl(input.receiver, "/txns-only/count")}?from=${input.receiver} txns[0].count`,
      by: "NearBlocks",
      effect: "evidence",
      reason: null,
    });
  }

  const prior = priorPayments(input.receiver);
  signals.push({
    name: "prior-payments",
    value: String(prior),
    source: `ledger.jsonl in ${dir()} entries with this receiver and verdict allow or kind settled`,
    by: "local ledger",
    effect: "evidence",
    reason: null,
  });

  signals.push({
    name: "amount",
    value: input.amount ?? "not supplied",
    source: "command --amount",
    by: "caller",
    effect: "evidence",
    reason: null,
  });
  signals.push({
    name: "token",
    value: input.token ?? "not supplied",
    source: "command --token",
    by: "caller",
    effect: "evidence",
    reason: null,
  });

  const blocks = signals.filter((signal) => signal.effect === "block" && signal.reason);
  const warns = signals.filter((signal) => signal.effect === "warn" && signal.reason);
  const verdict = blocks.length > 0 ? "block" : warns.length > 0 ? "warn" : "allow";
  const reasons = (verdict === "block" ? blocks : verdict === "warn" ? warns : []).map((signal) => signal.reason!);

  if (!hostile && verdict === "block") {
    const cause = reasons[0] ?? "block";
    remember("address", input.receiver, cause);
  }

  const entry = append("decision", {
    receiver: input.receiver,
    verdict,
    reasons,
    amount: input.amount ?? null,
    token: input.token ?? null,
  });

  return { verdict, reasons, signals, ledgerHash: entry.hash };
}

export function formatCheck(result: CheckResult): string {
  const lines: string[] = [result.verdict];
  for (const reason of result.reasons) lines.push(`reason: ${reason}`);
  for (const signal of result.signals) {
    lines.push(`evidence ${signal.name}: ${signal.value} ← ${signal.source} [${signal.by}]`);
  }
  lines.push(`ledger: ${result.ledgerHash}`);
  return lines.join("\n");
}
