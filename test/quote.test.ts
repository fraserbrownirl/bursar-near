import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attacks, demoReport } from "../src/demo.js";
import { inspectIntent, expectedTransfer } from "../src/intent.js";
import { quoteCheckLine, quoteFieldLine, reference1Click } from "../src/reference.js";
import { nearForUsdc, topupProblem } from "../src/near-topup.js";
import { adoptGenerated, signingStandard, withinDemoCap } from "../src/swap-intent.js";
import { ONECLICK_FEE_RECIPIENT, feeCapBps, payeeOf, reviewQuote, signatureOk, type BursarRequest, type SignedQuote } from "../src/quote.js";

function load(name: string): SignedQuote {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as SignedQuote;
}

test("captured quotes verify, and the fee recipient is the observed account at 20 bps", () => {
  for (const name of ["quote-dry.json", "quote-live.json"]) {
    const quote = load(name);
    assert.equal(signatureOk(quote), true);
    assert.equal(quote.quoteRequest.appFees?.[0]?.recipient, ONECLICK_FEE_RECIPIENT);
    assert.equal(quote.quoteRequest.appFees?.[0]?.fee, 20);
    assert.ok(20 <= feeCapBps({
      originAsset: quote.quoteRequest.originAsset,
      destinationAsset: quote.quoteRequest.destinationAsset,
    }));
  }
});

test("editing appFees leaves the 1Click signature valid", () => {
  const quote = load("quote-live.json");
  quote.quoteRequest.appFees = [{ recipient: "evil.near", fee: 300 }];
  assert.equal(signatureOk(quote), true);
  const now = Math.floor(Date.parse(quote.quote.deadline ?? "") / 1000) - 60;
  const original = load("quote-live.json");
  const asked: BursarRequest = {
    recipient: original.quoteRequest.recipient,
    refundTo: original.quoteRequest.refundTo,
    amount: original.quoteRequest.amount,
    originAsset: original.quoteRequest.originAsset,
    destinationAsset: original.quoteRequest.destinationAsset,
    deadline: original.quoteRequest.deadline,
    minAmountOut: original.quote.minAmountOut,
  };
  assert.equal(reviewQuote(quote, asked, now), "STOP: app fee 300 bps to evil.near");
});

test("a signed quote whose recipient differs from --to stops", () => {
  const quote = load("quote-live.json");
  const now = Math.floor(Date.parse(quote.quote.deadline ?? "") / 1000) - 60;
  const asked: BursarRequest = {
    recipient: "other.near",
    refundTo: quote.quoteRequest.refundTo,
    amount: quote.quoteRequest.amount,
    originAsset: quote.quoteRequest.originAsset,
    destinationAsset: quote.quoteRequest.destinationAsset,
    deadline: quote.quoteRequest.deadline,
    minAmountOut: quote.quote.minAmountOut,
  };
  assert.equal(signatureOk(quote), true);
  assert.equal(reviewQuote(quote, asked, now), "STOP: recipient");
});

test("bursar pay checks the recipient, not the deposit address", () => {
  const quote = load("quote-live.json");
  assert.equal(payeeOf(quote), quote.quoteRequest.recipient);
  assert.notEqual(payeeOf(quote), quote.quote.depositAddress);
  assert.equal(quote.quoteRequest.depositType, "INTENTS");
  assert.equal(inspectIntent({ intents: [expectedTransfer(quote)] }, quote), null);
});

test("npm run demo stops every attack", () => {
  const report = demoReport();
  assert.equal(report.code, 0, report.text);
  const names = attacks().map((row) => row.name);
  assert.deepEqual(names, [
    "injected blocklist",
    "tampered quote",
    "wrong recipient",
    "foreign refundTo",
    "low minAmountOut",
    "expired deadline",
    "dry quote used for payment",
    "unsigned fee field edited",
    "drainer bundle",
    "hidden notification",
    "intent deadline differs from the signed quote",
    "injected agent",
    "transfer to another account",
  ]);
});

test("the tampered quote receipt replays as fail recipient", () => {
  const receipt = JSON.parse(readFileSync(new URL("../receipts/b0a8acaf8bcfd5737d80466b5a7f51fff86a19f097b7ee5cd6d6fdbfe45ae04b.json", import.meta.url), "utf8")) as {
    cmd: string;
    inputs: { quote: string };
    output: string;
  };
  const quote = readFileSync(new URL(`../receipts/inputs/${receipt.inputs.quote}`, import.meta.url));
  assert.equal(reference1Click(receipt.cmd.slice("1click ".length).split(/\s+/), { quote }), "fail recipient");
  assert.equal(receipt.output, "fail recipient");
});

test("an EXACT_OUTPUT quote stated as its output replays as fail amount, and passes stated as its deposit", async () => {
  const receipt = JSON.parse(readFileSync(new URL("../receipts/01cdef18ecc74e6b5419a9028f470d09204b9a2f3c5082ec479357b14e86544a.json", import.meta.url), "utf8")) as {
    cmd: string;
    inputs: { quote: string };
    output: string;
  };
  const raw = readFileSync(new URL(`../receipts/inputs/${receipt.inputs.quote}`, import.meta.url));
  const text = raw.toString("utf8");
  const quote = JSON.parse(text.startsWith("{") ? text : Buffer.from(text.replace(/^0x/i, ""), "hex").toString("utf8")) as SignedQuote;
  assert.equal(reference1Click(receipt.cmd.slice("1click ".length).split(/\s+/), { quote: raw }), "fail amount");
  assert.equal(receipt.output, "fail amount");
  const { statedRequest } = await import("../src/model-checks.js");
  const request: BursarRequest = {
    recipient: quote.quoteRequest.recipient,
    refundTo: quote.quoteRequest.refundTo,
    amount: quote.quoteRequest.amount,
    originAsset: quote.quoteRequest.originAsset,
    destinationAsset: quote.quoteRequest.destinationAsset,
    deadline: quote.quoteRequest.deadline,
    minAmountOut: quote.quoteRequest.amount,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
  };
  const stated = statedRequest(quote, request);
  assert.equal(stated.amount, quote.quote.amountIn);
  assert.equal(stated.minAmountOut, quote.quoteRequest.amount);
  const now = Math.floor(Date.parse(quote.quote.deadline ?? "") / 1000) - 60;
  assert.equal(quoteCheckLine(quote, stated, now), "ok");
  const input: BursarRequest = { ...request, swapType: "EXACT_INPUT", amount: "250000", minAmountOut: "0" };
  const statedIn = statedRequest({ quote: { amountIn: "250000" } } as SignedQuote, input);
  assert.equal(statedIn.amount, "250000");
  assert.equal(statedIn.minAmountOut, "0");
});

test("1click check uses the caller's recipient, not the quote's", () => {
  const quote = load("quote-live.json");
  const now = Math.floor(Date.parse(quote.quote.deadline ?? "") / 1000) - 60;
  const expected = {
    recipient: quote.quoteRequest.recipient,
    refundTo: quote.quoteRequest.refundTo,
    destinationAsset: quote.quoteRequest.destinationAsset,
    amount: quote.quoteRequest.amount,
    minAmountOut: quote.quote.minAmountOut,
  };
  assert.equal(quoteCheckLine(quote, expected, now), "ok");
  assert.equal(quoteCheckLine(quote, { ...expected, recipient: "someone-else.near" }, now), "fail recipient");
});

test("1click check accepts an ed25519 implicit account and a 0x P-256 implicit account", () => {
  const vectors = JSON.parse(readFileSync(new URL("./fixtures/implicit-accounts.json", import.meta.url), "utf8")) as { name: string; account: string }[];
  const now = 1794000000;
  const asset = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  for (const vector of vectors) {
    const quote = {
      signature: "ed25519:x",
      quoteRequest: {
        dry: false,
        recipient: vector.account,
        refundTo: vector.account,
        destinationAsset: asset,
      },
      quote: {
        depositAddress: "ab".repeat(32),
        amountIn: "20000",
        minAmountOut: "0",
        deadline: "2026-12-01T00:00:00Z",
      },
    } as SignedQuote;
    const expected = {
      recipient: vector.account,
      refundTo: vector.account,
      destinationAsset: asset,
      amount: "20000",
      minAmountOut: "0",
    };
    assert.equal(quoteFieldLine(quote, expected, now), "ok", vector.name);
  }
});

test("a top-up quote must name the enclave as recipient and frsrcom.near as refund", () => {
  const quote = load("quote-live.json");
  assert.match(topupProblem(quote) ?? "", /^STOP: recipient /);
  assert.equal(nearForUsdc(100n, 25n, 50n), 210n);
  assert.equal(signingStandard("0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b"), "webauthn");
  assert.equal(signingStandard("ab".repeat(32)), "nep413");
  assert.equal(withinDemoCap("150000"), true);
  assert.equal(withinDemoCap("1000001"), false);
  const exact = { text: "" };
  const payload = "{\"signer_id\":\"0xabc\",\"verifying_contract\":\"intents.near\",\"deadline\":\"2026-11-12T00:00:00Z\",\"nonce\":\"bm9uY2U=\",\"intents\":[]}";
  const adopted = adoptGenerated({ intent: { payload } }, exact);
  assert.equal(exact.text, payload);
  assert.equal(adopted.intent.payload.recipient, "intents.near");
  assert.equal(adopted.intent.payload.nonce, "bm9uY2U=");
  assert.equal(nearForUsdc(100n, 0n, 50n), 0n);
});

test("a 0x implicit account is INTENTS only when the destination is on NEAR", async () => {
  const { recipientTypeFor } = await import("../src/account.js");
  const enclave = "0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b";
  assert.equal(recipientTypeFor("frsrcom.near", "nep141:arb-usdc.omft.near"), "INTENTS");
  assert.equal(recipientTypeFor(enclave, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), "INTENTS");
  assert.equal(recipientTypeFor(enclave, "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"), "DESTINATION_CHAIN");
  assert.equal(recipientTypeFor("BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp", "solana:USDC"), "DESTINATION_CHAIN");
});
