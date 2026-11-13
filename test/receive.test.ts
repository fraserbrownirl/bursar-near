import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { qrText } from "../src/code.js";
import { freshLine, paymentUri, readBridgeFixture, receivable, receive, watchLine, watchUntilReceived, type BridgeToken } from "../src/receive.js";

const fixturePath = fileURLToPath(new URL("./fixtures/bridge-deposit.json", import.meta.url));
const fixture = readBridgeFixture(fixturePath);
const account = "0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b";

test("a Base USDC deposit address is not the Intents account, and the request carries the amount", async () => {
  assert.equal(receivable(fixture.base.address, account, "evm"), null);
  assert.equal(receivable(account, account, "evm"), "STOP: address");
  const uri = paymentUri({
    rail: { id: "eth:8453", kind: "evm", evmChainId: 8453, label: "Base" },
    token: fixture.baseUsdc,
    address: fixture.base.address,
    amount: "0.1",
  });
  assert.equal(uri, `ethereum:${fixture.baseUsdc.origin_chain_address}@8453/transfer?address=${fixture.base.address}&uint256=100000`);
  assert.equal(uri.includes(account), false);
  const dir = mkdtempSync(join(tmpdir(), "bursar-receive-"));
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "supported_tokens") {
      return { json: async () => ({ result: { tokens: [fixture.baseUsdc] } }) } as Response;
    }
    return { json: async () => ({ result: fixture.base }) } as Response;
  };
  const drawn = await receive({ accountId: account, chain: "base", token: "USDC", amount: "0.1", dir, fetchImpl, tokens: [fixture.baseUsdc] });
  assert.equal(drawn.address, fixture.base.address);
  assert.equal(drawn.uri, uri);
  assert.equal(qrText(readFileSync(join(dir, "bursar-code.png"))), uri);
  const again = await receive({ accountId: account, chain: "base", token: "USDC", amount: "0.1 USDC", dir, fetchImpl, tokens: [fixture.baseUsdc] });
  assert.equal(again.uri, uri);
});

test("the watch matches an amount the model passed with the token attached", async () => {
  let polls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    polls += 1;
    const deposits = body.method === "recent_deposits" && polls > 1
      ? [{ amount: "0.15", sender: "buyer", tx_hash: "sig" }]
      : [];
    return { json: async () => ({ result: { deposits, total: deposits.length } }) } as Response;
  };
  const line = await watchUntilReceived({
    accountId: account,
    chain: "sol",
    token: "USDC",
    amount: "0.15 USDC",
    fetchImpl,
    wait: async () => undefined,
    maxPolls: 3,
  });
  assert.equal(line, "Received 0.15 USDC on Solana from buyer. https://solscan.io/tx/sig");
});

test("a bridge that keeps failing is reported, not silent", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("fetch failed");
  };
  const line = await watchUntilReceived({
    accountId: account,
    chain: "sol",
    token: "USDC",
    fetchImpl,
    wait: async () => undefined,
    maxPolls: 10,
  });
  assert.equal(line, "the bridge is not answering: fetch failed");
});

test("watch prints Received when a deposit row arrives", async () => {
  let polls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    polls += 1;
    const deposits = body.method === "recent_deposits" && polls > 1
      ? [{ amount: "0.15", sender: "buyer", tx_hash: "sig" }]
      : [];
    return { json: async () => ({ result: { deposits, total: deposits.length } }) } as Response;
  };
  const line = await watchUntilReceived({
    accountId: account,
    chain: "sol",
    token: "USDC",
    fetchImpl,
    wait: async () => undefined,
    maxPolls: 3,
  });
  assert.equal(line, "Received 0.15 USDC on Solana from buyer. https://solscan.io/tx/sig");
});

test("an empty deposit list is waiting, and a deposit row is a receipt line", () => {
  assert.equal(watchLine("eth:8453", "Base", "USDC", fixture.recent_deposits.deposits), "waiting");
  const line = watchLine("eth:8453", "Base", "USDC", [{ amount: "0.10", sender: "0xabc", tx_hash: "0xhash" }]);
  assert.equal(line, "Received 0.10 USDC on Base from 0xabc. https://basescan.org/tx/0xhash");
});

test("a deposit already on the account is not this sale", async () => {
  const old = { amount: 5000000, decimals: 6, from: "9mh5K4yEmhKRWBfZQppkM5SVsEb79s9qFuCFzDLFUFSW", tx_hash: "old" };
  const fetchImpl: typeof fetch = async () => ({ json: async () => ({ result: { deposits: [old], total: 1 } }) }) as Response;
  const line = await watchUntilReceived({
    accountId: account,
    chain: "sol",
    token: "USDC",
    amount: "0.15",
    fetchImpl,
    wait: async () => undefined,
    maxPolls: 2,
  });
  assert.equal(line, "waiting");
  assert.equal(freshLine("sol:mainnet", "Solana", "USDC", [old, { amount: "0.15", sender: "buyer", tx_hash: "sig" }], new Set(["old"]), "0.15"), "Received 0.15 USDC on Solana from buyer. https://solscan.io/tx/sig");
});

test("a Solana deposit amount is atomic units with decimals", () => {
  // recent_deposits sol:mainnet for 0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b on 2026-11-12
  const line = watchLine("sol:mainnet", "Solana", "USDC", [{
    amount: 5000000,
    decimals: 6,
    from: "9mh5K4yEmhKRWBfZQppkM5SVsEb79s9qFuCFzDLFUFSW",
    tx_hash: "654PYPoTrEVRTnvkT8ocLacQ3ghMzSiuWsJi7FfZF1cebcYX6ULPykgHDFjFFCJMQSi9ecZCVyKsChJNB3yJmLDu",
  }]);
  assert.equal(
    line,
    "Received 5 USDC on Solana from 9mh5K4yEmhKRWBfZQppkM5SVsEb79s9qFuCFzDLFUFSW. https://solscan.io/tx/654PYPoTrEVRTnvkT8ocLacQ3ghMzSiuWsJi7FfZF1cebcYX6ULPykgHDFjFFCJMQSi9ecZCVyKsChJNB3yJmLDu",
  );
});

test("the wrong token is refused before a QR", async () => {
  const tokens: BridgeToken[] = [fixture.baseUsdc];
  await assert.rejects(() => receive({ accountId: account, chain: "base", token: "DOGE", tokens, fetchImpl: async () => { throw new Error("network"); } }), /STOP: token/);
});
