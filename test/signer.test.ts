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
  const live = JSON.parse(readFileSync(new URL("./fixtures/quote-4min.json", import.meta.url), "utf8")) as SignedQuote;
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent-4min.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string; nonce: string; recipient: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as { signer_id: string; intents: IntentPayload["intents"] };
  const now = Date.parse(live.quote.deadline ?? "") - 2 * 60 * 1000;
  let calls = 0;
  const inner: IIntentSigner = {
    async signIntent() {
      calls += 1;
      throw new Error("inner signer was called");
    },
  };
  const signer = new BursarGuardedSigner(inner, { accountId: message.signer_id, quote: live, now: () => now });
  await assert.rejects(() => signer.signIntent({
    verifying_contract: "intents.near",
    deadline: live.quote.deadline ?? "",
    nonce: generated.intent.payload.nonce,
    signer_id: message.signer_id,
    intents: [
      message.intents[0]!,
      { intent: "add_public_key", public_key: "ed25519:x" },
    ] as IntentPayload["intents"],
  }), /STOP: 2 intents/);
  assert.equal(calls, 0);
});

test("a 4-minute quote's intent deadline must equal the signed quote deadline and sit inside 5 minutes", async () => {
  const live = JSON.parse(readFileSync(new URL("./fixtures/quote-4min.json", import.meta.url), "utf8")) as SignedQuote;
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent-4min.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string; nonce: string; recipient: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as { deadline: string; signer_id: string; intents: IntentPayload["intents"] };
  const quoteDeadline = Date.parse(live.quote.deadline ?? "");
  const now = quoteDeadline - 2 * 60 * 1000;
  let calls = 0;
  const inner: IIntentSigner = {
    async signIntent(intent) {
      calls += 1;
      return { standard: "nep413", payload: { message: "", nonce: intent.nonce, recipient: "intents.near" }, public_key: "ed25519:x", signature: "ed25519:x" } as never;
    },
  };
  const signer = new BursarGuardedSigner(inner, { accountId: message.signer_id, quote: live, now: () => now });
  await signer.signIntent({
    verifying_contract: generated.intent.payload.recipient,
    deadline: message.deadline,
    nonce: generated.intent.payload.nonce,
    signer_id: message.signer_id,
    intents: message.intents,
  });
  assert.equal(calls, 1);
  const shifted = new BursarGuardedSigner(inner, { accountId: message.signer_id, quote: live, now: () => now });
  await assert.rejects(() => shifted.signIntent({
    verifying_contract: "intents.near",
    deadline: new Date(now + 60 * 1000).toISOString(),
    nonce: "other-nonce",
    signer_id: message.signer_id,
    intents: message.intents,
  }), /STOP: deadline/);
});

test("intent deadline differs from the signed quote and the inner signer is never called", async () => {
  const live = JSON.parse(readFileSync(new URL("./fixtures/quote-4min.json", import.meta.url), "utf8")) as SignedQuote;
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent-4min.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string; nonce: string; recipient: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as { signer_id: string; intents: IntentPayload["intents"] };
  const now = Date.parse(live.quote.deadline ?? "") - 2 * 60 * 1000;
  let calls = 0;
  const inner: IIntentSigner = {
    async signIntent() {
      calls += 1;
      throw new Error("inner signer was called");
    },
  };
  const signer = new BursarGuardedSigner(inner, { accountId: message.signer_id, quote: live, now: () => now });
  await assert.rejects(() => signer.signIntent({
    verifying_contract: "intents.near",
    deadline: new Date(Date.parse(live.quote.deadline ?? "") - 1000).toISOString(),
    nonce: generated.intent.payload.nonce,
    signer_id: message.signer_id,
    intents: message.intents,
  }), /STOP: deadline/);
  assert.equal(calls, 0);
});
