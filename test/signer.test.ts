import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { IIntentSigner, IntentPayload } from "@defuse-protocol/intents-sdk";
import { BursarGuardedSigner } from "../src/signer.js";
import type { SignedQuote } from "../src/quote.js";

function quote(): SignedQuote {
  return JSON.parse(readFileSync(new URL("./fixtures/quote-live.json", import.meta.url), "utf8")) as SignedQuote;
}

function payload(over: Partial<IntentPayload> = {}): IntentPayload {
  const live = quote();
  const now = Date.parse("2026-11-10T12:00:00Z");
  return {
    verifying_contract: "intents.near",
    deadline: new Date(now + 60_000).toISOString(),
    nonce: "bm9uY2UtMQ==",
    signer_id: "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54",
    intents: [{
      intent: "transfer",
      receiver_id: live.quote.depositAddress,
      tokens: { [live.quoteRequest.originAsset]: live.quote.amountIn },
    }],
    ...over,
  } as IntentPayload;
}

test("a drainer payload reaches signIntent and the inner signer is never called", async () => {
  let calls = 0;
  const inner: IIntentSigner = {
    async signIntent() {
      calls += 1;
      throw new Error("inner signer was called");
    },
  };
  const signer = new BursarGuardedSigner(inner, {
    accountId: "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54",
    quote: quote(),
    now: () => Date.parse("2026-11-10T12:00:00Z"),
  });
  const drainer = payload({
    intents: [
      payload().intents[0]!,
      { intent: "add_public_key", public_key: "ed25519:x" },
    ] as IntentPayload["intents"],
  });
  await assert.rejects(() => signer.signIntent(drainer), /STOP: 2 intents/);
  assert.equal(calls, 0);
});

test("a deadline more than five minutes out never reaches the inner signer", async () => {
  let calls = 0;
  const inner: IIntentSigner = {
    async signIntent() {
      calls += 1;
      throw new Error("inner signer was called");
    },
  };
  const signer = new BursarGuardedSigner(inner, {
    accountId: "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54",
    quote: quote(),
    now: () => Date.parse("2026-11-10T12:00:00Z"),
  });
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string; nonce: string; recipient: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as { deadline: string; signer_id: string; intents: IntentPayload["intents"] };
  await assert.rejects(() => signer.signIntent({
    verifying_contract: generated.intent.payload.recipient,
    deadline: message.deadline,
    nonce: generated.intent.payload.nonce,
    signer_id: message.signer_id,
    intents: message.intents,
  }), /STOP: deadline/);
  assert.equal(calls, 0);
});
