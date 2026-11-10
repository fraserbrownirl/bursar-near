import assert from "node:assert/strict";
import test from "node:test";
import { signatureOk, type SignedQuote } from "../src/quote.js";

const live = process.env.LIVE_TESTS === "1";

test("live quote and an RPC account read", { skip: live ? false : "set LIVE_TESTS=1" }, async () => {
  const account = process.env.BURSAR_NEAR_ACCOUNT;
  assert.ok(account, "BURSAR_NEAR_ACCOUNT is the refund and recipient account");
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    depositType: "INTENTS",
    originAsset: "nep141:wrap.near",
    destinationAsset: "nep141:usdt.tether-token.near",
    amount: "1000000000000000000000000",
    recipient: account,
    recipientType: "INTENTS",
    refundTo: account,
    refundType: "INTENTS",
    slippageTolerance: 100,
    deadline: "2026-11-12T00:00:00Z",
  };
  const quoteResponse = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(quoteResponse.status, 201);
  const quote = await quoteResponse.json() as SignedQuote;
  assert.equal(signatureOk(quote), true);

  const rpc = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "dontcare",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: "frol.near" },
    }),
  });
  const view = await rpc.json() as { result?: { code_hash?: string } };
  assert.equal(view.result?.code_hash, "11111111111111111111111111111111");
});
