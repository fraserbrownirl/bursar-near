import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chargeParameters, payerRefund } from "../src/merchant.js";
import { referenceUi } from "../src/model.js";
import { assetsMatch, BASE_USDC_CAIP, challengeLine, MPP_LIMIT_ATOMIC, NEAR_USDC_CAIP, reviewMpp } from "../src/mpp.js";
import { payMppChallenge } from "../src/mpp-pay.js";
import type { SignedQuote } from "../src/quote.js";
import { signGuardedTransfer, usdcTransfer, type FtTransfer } from "../src/signer.js";

function live(): SignedQuote {
  return JSON.parse(readFileSync(new URL("./fixtures/quote-live.json", import.meta.url), "utf8")) as SignedQuote;
}

const PAYER = "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54";

function request(quote: SignedQuote, amountOut = quote.quote.amountOut ?? "") {
  return {
    amount: quote.quote.amountIn,
    currency: quote.quoteRequest.originAsset,
    recipient: quote.quote.depositAddress ?? "",
    description: "demo merchant",
    methodDetails: {
      destinationAsset: quote.quoteRequest.destinationAsset,
      destinationRecipient: quote.quoteRequest.recipient,
      amountOut,
      minAmountIn: quote.quote.minAmountIn ?? "",
      refundTo: quote.quoteRequest.refundTo,
      depositMemo: quote.quote.depositMemo ?? null,
    },
  };
}

test("a CAIP-19 id matches the 1Click id for the same asset", () => {
  assert.equal(assetsMatch("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", NEAR_USDC_CAIP), true);
  assert.equal(assetsMatch("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", BASE_USDC_CAIP), true);
  assert.equal(assetsMatch("nep141:wrap.near", "nep141:usdt.tether-token.near"), false);
});

test("the 402 line names the price and the recipient", () => {
  const asked = request(live());
  assert.equal(
    challengeLine(asked),
    `402 ${referenceUi(asked.methodDetails.amountOut, 6)} USDC to ${asked.methodDetails.destinationRecipient}`,
  );
});

test("the card names the amount and the merchant, and a passing review is under the cap", () => {
  const quote = live();
  const asked = request(quote);
  const reviewed = reviewMpp({
    accountId: PAYER,
    request: asked,
    expires: "2026-11-14T12:00:00.000Z",
    quote,
    nowMs: Date.parse("2026-11-11T00:00:00.000Z"),
    limitAtomic: asked.amount,
  });
  assert.equal(reviewed.stop, null);
  assert.equal(reviewed.card, `Pay ${referenceUi(asked.amount, 6)} USDC to demo merchant?`);
  assert.equal(MPP_LIMIT_ATOMIC, "1000000");
});

test("a refused transfer does not call the broadcaster", async () => {
  const quote = live();
  const action = usdcTransfer(quote.quote.depositAddress ?? "", quote.quote.amountIn, null);
  const wrong: FtTransfer = { ...action, args: { ...action.args, receiver_id: "not-the-deposit.near" } };
  let calls = 0;
  await assert.rejects(
    () => signGuardedTransfer(wrong, {
      depositAddress: quote.quote.depositAddress ?? "",
      amount: quote.quote.amountIn,
      memo: null,
    }, async () => {
      calls += 1;
      return "hash";
    }),
    /STOP: receiver_id not-the-deposit\.near/,
  );
  assert.equal(calls, 0);
});

test("no on the card does not send, and yes sends the challenge amount to the deposit address", async () => {
  const quote = live();
  const asked = request(quote);
  const shared = {
    accountId: PAYER,
    request: asked,
    expires: "2026-11-14T12:00:00.000Z",
    quote,
    nowMs: Date.parse("2026-11-11T00:00:00.000Z"),
    limitAtomic: asked.amount,
    checkQuote: async () => null,
    guard: () => ({ verdict: "allow" as const, reasons: [] }),
  };
  let calls = 0;
  const refused = await payMppChallenge({
    ...shared,
    approve: async (_reasons, card) => {
      assert.match(card, /^Pay .+ USDC to demo merchant\?$/);
      return false;
    },
    send: async () => {
      calls += 1;
      return "hash";
    },
  });
  assert.equal(refused.stop, "STOP");
  assert.equal(calls, 0);
  const paid = await payMppChallenge({
    ...shared,
    approve: async () => true,
    send: async (amount, deposit) => {
      calls += 1;
      assert.equal(amount, asked.amount);
      assert.equal(deposit, asked.recipient);
      return "near-hash";
    },
  });
  assert.equal(paid.stop, null);
  assert.equal(paid.hash, "near-hash");
  assert.equal(calls, 1);
});

test("an intents delivery asks exact output of the challenge amount to the deposit address", async () => {
  const { intentsDelivery } = await import("../src/mpp-deliver.js");
  const challenge = request(live());
  const delivery = intentsDelivery(challenge, PAYER, "nep141:arb-usdc.omft.near", "2026-11-11T12:00:00.000Z");
  assert.equal(delivery.swapType, "EXACT_OUTPUT");
  assert.equal(delivery.amount, challenge.amount);
  assert.equal(delivery.recipient, challenge.recipient);
  assert.equal(delivery.minAmountOut, challenge.amount);
  assert.equal(delivery.refundTo, PAYER);
  assert.equal(delivery.originAsset, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
});

test("the merchant charges NEAR USDC for Base USDC and does not attach a JWT unless one is set", () => {
  const plain = chargeParameters({
    destinationRecipient: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    name: "demo merchant",
  });
  assert.equal(plain.originAsset, NEAR_USDC_CAIP);
  assert.equal(plain.destinationAsset, BASE_USDC_CAIP);
  assert.equal(plain.amountOut, "250000");
  assert.equal("oneClick" in plain, false);
  const authed = chargeParameters({
    destinationRecipient: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    name: "demo merchant",
    jwt: "token",
  });
  assert.equal(authed.oneClick?.jwt, "token");
  assert.equal(payerRefund({ get: (name) => name === "x-bursar-account" ? PAYER : null }), PAYER);
  assert.throws(() => payerRefund({ get: () => null }), /x-bursar-account/);
});
