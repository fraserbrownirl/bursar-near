import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { qrText } from "../src/code.js";
import { paymentUri, readBridgeFixture, receivable, receive, watchLine, type BridgeToken } from "../src/receive.js";

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
});

test("an empty deposit list is waiting, and a deposit row is a receipt line", () => {
  assert.equal(watchLine("eth:8453", "Base", "USDC", fixture.recent_deposits.deposits), "waiting");
  const line = watchLine("eth:8453", "Base", "USDC", [{ amount: "0.10", sender: "0xabc", tx_hash: "0xhash" }]);
  assert.equal(line, "Received 0.10 USDC on Base from 0xabc. https://basescan.org/tx/0xhash");
});

test("the wrong token is refused before a QR", async () => {
  const tokens: BridgeToken[] = [fixture.baseUsdc];
  await assert.rejects(() => receive({ accountId: account, chain: "base", token: "DOGE", tokens, fetchImpl: async () => { throw new Error("network"); } }), /STOP: token/);
});
