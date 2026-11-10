import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attacks, demoReport } from "../src/demo.js";
import { inspectIntent, expectedTransfer } from "../src/intent.js";
import { ONECLICK_FEE_RECIPIENT, feeCapBps, payeeOf, reviewQuote, requestFromQuote, signatureOk, type SignedQuote } from "../src/quote.js";

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
  assert.equal(reviewQuote(quote, requestFromQuote(load("quote-live.json")), now), "STOP: app fee 300 bps to evil.near");
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
    "transfer to another account",
  ]);
});
