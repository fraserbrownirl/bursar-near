import { verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";
import { isNearAccount } from "../src/account.ts";
import { runAttacks } from "../src/demo-attacks.ts";
import { NEAR_RPC, NEARBLOCKS, decide, formatCheck, type ChainFacts, type Signal } from "../src/decide.ts";
import type { Fetcher } from "../src/load.ts";
import { loadFacts } from "../src/load.ts";
import { loadBlocklist } from "../src/blocklist.ts";
import { fetchLiveOrRecorded } from "../src/recorded-fetch.ts";
import { reviewQuote, type BursarRequest, type SignedQuote } from "../src/quote.ts";
import { homeFor } from "./env.ts";
import quoteLiveRaw from "../test/fixtures/quote-live.json?raw";
import quoteDryRaw from "../test/fixtures/quote-dry.json?raw";
import quoteFourRaw from "../test/fixtures/quote-4min.json?raw";
import generatedRaw from "../test/fixtures/generate-intent.json?raw";
import wrapView from "../test/fixtures/wrap.near.view-account.json?raw";
import frolView from "../test/fixtures/frol.near.view-account.json?raw";
import wrapAccount from "../test/fixtures/wrap.near.account.json?raw";
import wrapCount from "../test/fixtures/wrap.near.txns-count.json?raw";
import wrapDeploy from "../test/fixtures/wrap.near.deployments.json?raw";
import blocklistGet from "../test/fixtures/blocklist.get-bad1794304962694.near.json?raw";
import payRun from "./runs/pay-citable.txt?raw";
import attackRun from "./runs/attacks.txt?raw";

const CHAIN_RECORDED = "2026-11-10";
const TESTNET_RPC = "https://rpc.testnet.near.org";
const REPORTED = "bad1794304962694.near";

const live = JSON.parse(quoteLiveRaw) as SignedQuote;
const asked: BursarRequest = {
  recipient: live.quoteRequest.recipient,
  refundTo: live.quoteRequest.refundTo,
  amount: live.quoteRequest.amount,
  originAsset: live.quoteRequest.originAsset,
  destinationAsset: live.quoteRequest.destinationAsset,
  deadline: live.quoteRequest.deadline,
  minAmountOut: live.quote.minAmountOut,
};

function emptyFacts(): ChainFacts {
  return { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };
}

function accountFromView(init?: RequestInit): string | undefined {
  if (!init?.body) return undefined;
  try {
    const body = JSON.parse(String(init.body)) as { params?: { account_id?: string } };
    return body.params?.account_id;
  } catch {
    return undefined;
  }
}

function accountFromGet(init?: RequestInit): string | undefined {
  if (!init?.body) return undefined;
  try {
    const body = JSON.parse(String(init.body)) as { params?: { args_base64?: string } };
    const encoded = body.params?.args_base64;
    if (!encoded) return undefined;
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))) as { account?: string };
    return json.account;
  } catch {
    return undefined;
  }
}

function recordedBody(url: string, init?: RequestInit): string | undefined {
  if (url === NEAR_RPC) {
    const account = accountFromView(init);
    if (account === "wrap.near") return wrapView;
    if (account === "frol.near") return frolView;
    return undefined;
  }
  if (url === TESTNET_RPC) return accountFromGet(init) === REPORTED ? blocklistGet : undefined;
  if (url === `${NEARBLOCKS}/wrap.near`) return wrapAccount;
  if (url === `${NEARBLOCKS}/wrap.near/txns-only/count?from=wrap.near`) return wrapCount;
  if (url === `${NEARBLOCKS}/wrap.near/contract/deployments`) return wrapDeploy;
  return undefined;
}

async function fetchNearBlocks(
  url: string,
  init: RequestInit | undefined,
  recordedBody: string | undefined,
): Promise<{ response: Response; recorded: boolean }> {
  let delay = 500;
  let last: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status !== 429) return { response, recorded: false };
      last = response;
    } catch (error) {
      if (recordedBody === undefined) throw error;
      return {
        response: new Response(recordedBody, { status: 200, headers: { "content-type": "application/json" } }),
        recorded: true,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2;
  }
  if (recordedBody !== undefined) {
    return {
      response: new Response(recordedBody, { status: 200, headers: { "content-type": "application/json" } }),
      recorded: true,
    };
  }
  return { response: last ?? new Response("", { status: 429 }), recorded: false };
}

function usesUrl(source: string, url: string): boolean {
  return source.includes(`${url} `) || source.includes(`${url}?`) || source.endsWith(url);
}

async function checkAccount(receiver: string, amount?: string, token?: string, request?: string): Promise<string> {
  homeFor(receiver.replace(/[^a-z0-9.-]/gi, "_") + Date.now().toString());
  const recordedUrls: string[] = [];
  const missed: string[] = [];
  let blocklistRecorded = false;
  const fetchImpl: Fetcher = async (url, init) => {
    const target = String(url);
    const body = recordedBody(target, init);
    const timed: RequestInit = { ...init, signal: AbortSignal.timeout(8_000) };
    try {
      const result = target.includes("api.nearblocks.io")
        ? await fetchNearBlocks(target, timed, body)
        : await fetchLiveOrRecorded(fetch, target, timed, body);
      if (result.recorded) {
        if (target === TESTNET_RPC || target === "https://rpc.mainnet.near.org") blocklistRecorded = true;
        else recordedUrls.push(target);
      }
      return result.response;
    } catch (error) {
      missed.push(target);
      throw error;
    }
  };
  const facts = isNearAccount(receiver) ? await loadFacts(receiver, fetchImpl) : emptyFacts();
  const blocklist = await loadBlocklist(receiver, fetchImpl);
  const result = decide({
    receiver,
    nowNs: BigInt(Date.now()) * 1_000_000n,
    amount: amount || undefined,
    token: token || undefined,
    request: request || undefined,
    facts,
    payees: {},
    blocklist,
  });
  const text = formatCheck(result, (signal: Signal) => {
    if (signal.name === "blocklist" && blocklistRecorded) return CHAIN_RECORDED;
    return recordedUrls.some((url) => usesUrl(signal.source, url)) ? CHAIN_RECORDED : null;
  });
  if (missed.length === 0) return text;
  return `${text}\n\nbrowser could not read, no recording:\n${missed.join("\n")}`;
}

function verdictClass(line: string): string {
  if (line === "allow") return "allow";
  if (line === "warn") return "warn";
  return "stop";
}

function showAttacks(): void {
  homeFor("attacks");
  const root = document.querySelector("#attack-list");
  if (!root) return;
  const attacks = runAttacks({
    live: quoteLiveRaw,
    dry: quoteDryRaw,
    four: quoteFourRaw,
    generated: generatedRaw,
  });
  for (const attack of attacks) {
    const article = document.createElement("article");
    const title = document.createElement("h3");
    title.textContent = attack.name;
    const line = document.createElement("p");
    line.className = verdictClass(attack.line);
    line.textContent = attack.line;
    const evidence = document.createElement("pre");
    evidence.textContent = attack.evidence;
    article.append(title, line, evidence);
    root.append(article);
  }
}

function showQuote(): void {
  const askedNode = document.querySelector("#asked");
  const editor = document.querySelector("#quote-json");
  const result = document.querySelector("#quote-result");
  if (!(askedNode instanceof HTMLElement) || !(editor instanceof HTMLTextAreaElement) || !(result instanceof HTMLElement)) return;
  askedNode.textContent = JSON.stringify(asked, null, 2);
  editor.value = JSON.stringify(live, null, 2);
  const run = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.value);
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    const quote = parsed as SignedQuote;
    let signature: string;
    try {
      signature = `verifyQuoteSignature ${String(verifyQuoteSignature(quote as never))}`;
    } catch (error) {
      signature = error instanceof Error ? error.message : String(error);
    }
    let reviewed: string;
    try {
      reviewed = reviewQuote(quote, asked, Math.floor(Date.now() / 1000)) ?? "reviewQuote: no STOP";
    } catch (error) {
      reviewed = error instanceof Error ? error.message : String(error);
    }
    result.textContent = `${signature}\n${reviewed}`;
  };
  editor.addEventListener("input", run);
  run();
}

function showModel(): void {
  const pay = document.querySelector("#pay-run");
  const attacks = document.querySelector("#attack-run");
  const video = document.querySelector("#demo-video");
  if (pay) pay.textContent = payRun.trim();
  if (attacks) attacks.textContent = attackRun.trim();
  if (video instanceof HTMLVideoElement) video.src = `${import.meta.env.BASE_URL}bursar-demo-v4.mp4`;
}

async function showCheck(receiver: string, amount = "", token = "", request = ""): Promise<void> {
  const node = document.querySelector("#check-result");
  if (!(node instanceof HTMLElement)) return;
  node.textContent = `Checking ${receiver}…`;
  try {
    node.textContent = await checkAccount(receiver, amount, token, request);
    const first = node.textContent.split("\n")[0] ?? "";
    node.className = verdictClass(first);
  } catch (error) {
    node.textContent = error instanceof Error ? error.message : String(error);
  }
}

function wireCheck(): void {
  const form = document.querySelector("#check-form");
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    void showCheck(String(data.get("account") ?? "").trim(), String(data.get("amount") ?? ""), String(data.get("token") ?? ""), String(data.get("request") ?? ""));
  });
  for (const button of form.querySelectorAll("button[data-account]")) {
    button.addEventListener("click", () => {
      const account = button.getAttribute("data-account") ?? "";
      const input = form.elements.namedItem("account");
      if (input instanceof HTMLInputElement) input.value = account;
      void showCheck(account);
    });
  }
}

async function showAgent(): Promise<void> {
  const node = document.querySelector("#agent-result");
  if (!(node instanceof HTMLElement)) return;
  try {
    node.textContent = await checkAccount(REPORTED, undefined, undefined, `pay ${REPORTED}`);
    const first = node.textContent.split("\n")[0] ?? "";
    node.className = verdictClass(first);
  } catch (error) {
    node.textContent = error instanceof Error ? error.message : String(error);
  }
}

function referenceUi(atomic: string, decimals: number): string {
  const value = BigInt(atomic);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

function browserReference(cmd: string): string | null {
  const ui = cmd.match(/^(?:sol\s+)?ui\s+(\d+)\s+(\d+)$/);
  if (ui) return referenceUi(ui[1], Number(ui[2]));
  return null;
}

function showReceipts(): void {
  const root = document.querySelector("#receipt-list");
  if (!root) return;
  const loaded = import.meta.glob("../receipts/*.json", { eager: true }) as Record<string, { default: { cmd: string; output: string } }>;
  const paths = Object.keys(loaded).filter((path) => /[0-9a-f]{64}\.json$/.test(path)).sort();
  if (paths.length === 0) {
    root.textContent = "no receipts";
    return;
  }
  for (const path of paths) {
    const hash = path.match(/([0-9a-f]{64})\.json$/)?.[1] ?? path;
    const receipt = loaded[path].default;
    const got = browserReference(receipt.cmd);
    const verdict = got === null ? null : got === receipt.output ? "match" : "MISMATCH";
    const article = document.createElement("article");
    const line = document.createElement("p");
    line.className = verdict === "match" ? "allow" : "stop";
    line.textContent = verdict === null
      ? `${receipt.cmd} → ${receipt.output}  (npm run verify recomputes this command)`
      : `${verdict}  ${receipt.cmd} → ${receipt.output}`;
    const id = document.createElement("p");
    id.textContent = hash;
    article.append(line, id);
    root.append(article);
  }
}

showReceipts();
showAttacks();
showQuote();
showModel();
wireCheck();
void (async () => {
  await showAgent();
  await showCheck("wrap.near");
})();
