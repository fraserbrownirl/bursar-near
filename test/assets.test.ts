import assert from "node:assert/strict";
import test from "node:test";
import { pricePayment, resolveAsset, type Asset } from "../src/assets.js";
import type { TokenRow } from "../src/decimals.js";
import { referenceCheck, type BursarRequest, type SignedQuote } from "../src/quote.js";

const NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SOL = "nep141:sol-EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.omft.near";

const rows: TokenRow[] = [
  { assetId: NEAR, decimals: 6, symbol: "USDC" },
  { assetId: BASE, decimals: 6, symbol: "USDC", blockchain: "base" },
  { assetId: SOL, decimals: 6, symbol: "USDC" },
  { assetId: "nep141:eth.omft.near", decimals: 18, symbol: "ETH", blockchain: "eth" },
];

function asset(found: Asset | { ask: string }): Asset {
  if ("ask" in found) throw new Error(found.ask);
  return found;
}

test("USDC with no chain prefix is NEAR, and a base row is base", () => {
  assert.equal(asset(resolveAsset(rows, "USDC", "near")).assetId, NEAR);
  assert.equal(asset(resolveAsset(rows, "usdc", "base")).assetId, BASE);
  assert.equal(asset(resolveAsset(rows, "USDC", "sol")).blockchain, "sol");
});

test("a NEAR account spends NEAR USDC exactly, and another chain is an exact output", () => {
  const same = pricePayment(rows, { to: "frsrcom.near", human: "0.25", asset: "USDC", chain: "" });
  assert.equal("ask" in same, false);
  if (!("ask" in same)) {
    assert.equal(same.swapType, "EXACT_INPUT");
    assert.equal(same.amount, "250000");
    assert.equal(same.dest.blockchain, "near");
  }
  const base = pricePayment(rows, { to: "0xabc", human: "0.25", asset: "USDC", chain: "base" });
  assert.equal("ask" in base, false);
  if (!("ask" in base)) {
    assert.equal(base.swapType, "EXACT_OUTPUT");
    assert.equal(base.dest.assetId, BASE);
    assert.equal(base.origin.assetId, NEAR);
    assert.equal(base.amount, "250000");
  }
});

test("an address with no chain is a question, and so is an unknown token", () => {
  const chain = pricePayment(rows, { to: "0xabc", human: "0.25", asset: "USDC", chain: "" });
  assert.deepEqual(chain, { ask: "Which chain?" });
  const missing = pricePayment(rows, { to: "frsrcom.near", human: "1", asset: "DOGE", chain: "near" });
  assert.deepEqual(missing, { ask: "I don't know DOGE on near." });
});

test("an exact output compares the signed amount, not the USDC spent", () => {
  const request: BursarRequest = {
    recipient: "0xabc",
    refundTo: "me.near",
    amount: "10000000000000000",
    originAsset: NEAR,
    destinationAsset: "nep141:eth.omft.near",
    deadline: "2030-01-01T00:00:00.000Z",
    minAmountOut: "0",
    swapType: "EXACT_OUTPUT",
  };
  const quote = {
    signature: "",
    timestamp: "",
    correlationId: "",
    quoteRequest: {
      dry: false,
      recipient: request.recipient,
      refundTo: request.refundTo,
      amount: request.amount,
      originAsset: request.originAsset,
      destinationAsset: request.destinationAsset,
      deadline: request.deadline,
      depositType: "INTENTS",
      refundType: "INTENTS",
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
    },
    quote: {
      depositAddress: "af749404b7c7bdc9482a9a378f8435a1be3bb2e6b3bc37942afe2d7c0cb0ab82",
      amountIn: "999",
      minAmountOut: request.amount,
      deadline: "2030-01-01T00:04:00.000Z",
    },
  } as SignedQuote;
  assert.deepEqual(referenceCheck(quote, request, 1_700_000_000), []);
});
