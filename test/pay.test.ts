import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { IIntentSigner } from "@defuse-protocol/intents-sdk";
import { settle, type GeneratedIntent } from "../src/pay.js";
import type { SignedQuote } from "../src/quote.js";

test("the captured generate-intent deadline stops before submitIntent", async () => {
  const quote = JSON.parse(readFileSync(new URL("./fixtures/quote-live.json", import.meta.url), "utf8")) as SignedQuote;
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent.json", import.meta.url), "utf8")) as GeneratedIntent;
  let submits = 0;
  const signer: IIntentSigner = {
    async signIntent() {
      throw new Error("STOP: deadline");
    },
  };
  const line = await settle({
    quote,
    accountId: quote.quoteRequest.refundTo,
    nowSec: Math.floor(Date.parse(quote.quote.deadline ?? "") / 1000) - 60,
    signer,
    generateIntent: async () => generated,
    submitIntent: async () => {
      submits += 1;
    },
  });
  assert.equal(line, "STOP: deadline");
  assert.equal(submits, 0);
});
