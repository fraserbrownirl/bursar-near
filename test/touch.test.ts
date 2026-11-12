import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { baseDecode } from "@near-js/utils";
import type { IntentPayload } from "@defuse-protocol/intents-sdk";
import { keccak256 } from "viem";
import { BursarGuardedSigner, defusePayload, nep413Hash, webAuthnFields } from "../src/signer.js";
import type { SignedQuote } from "../src/quote.js";

test("a P-256 implicit account is keccak256 of p256 and the 64-byte key", () => {
  const raw = Buffer.from(baseDecode("2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q"));
  assert.equal(raw.length, 64);
  const hash = Buffer.from(keccak256(Buffer.concat([Buffer.from("p256"), raw])).slice(2), "hex");
  assert.equal(`0x${hash.subarray(12).toString("hex")}`, "0x3602b546589a8fcafdce7fad64a46f91db0e4d50");
});

test("webauthn fields match the shared Swift preparation", () => {
  const payload = "{\"signer_id\":\"0x3602b546589a8fcafdce7fad64a46f91db0e4d50\",\"verifying_contract\":\"intents.near\",\"deadline\":\"2025-03-30T00:00:00Z\",\"nonce\":\"A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=\",\"intents\":[]}";
  const fields = webAuthnFields(payload);
  assert.equal(fields.clientDataJSON, "{\"type\":\"webauthn.get\",\"challenge\":\"MbTzSonGcTcb_b0LtpYrUeMCS9l-BiBBg295V7Gtioo\",\"origin\":\"https://app.bursar.phone\"}");
  assert.equal(fields.authenticatorData, "Kr_4zTawyJxmNmbOyeu1g3cIxftSZ3Aa8lKX1XIOYf0FAAAAAA");
  assert.equal(fields.messageHex, "2abff8cd36b0c89c663666cec9ebb5837708c5fb5267701af25297d5720e61fd0500000000dd31f9c1ebfd9ce62f024ca922f868b66fbba1b704258fcc7e4bd760606f36e8");
  assert.equal(defusePayload({
    signer_id: "0x3602b546589a8fcafdce7fad64a46f91db0e4d50",
    verifying_contract: "intents.near",
    deadline: "2025-03-30T00:00:00Z",
    nonce: "A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=",
    intents: [],
  }), payload);
});

test("the NEP-413 hash matches the Intents SDK", async () => {
  const sdk = await import(new URL("../node_modules/@defuse-protocol/intents-sdk/dist/src/lib/nep413.js", import.meta.url).href) as {
    hashNEP413Message: (input: { message: string; nonce: Uint8Array; recipient: string }) => Promise<Uint8Array>;
  };
  const message = "pay";
  const nonce = new Uint8Array(32).fill(7);
  const recipient = "intents.near";
  const ours = nep413Hash({ message, nonce, recipient });
  const theirs = await sdk.hashNEP413Message({ message, nonce, recipient });
  assert.equal(Buffer.from(ours).toString("hex"), Buffer.from(theirs).toString("hex"));
});

test("a stopped intent does not ask the helper to sign", async () => {
  const live = JSON.parse(readFileSync(new URL("./fixtures/quote-4min.json", import.meta.url), "utf8")) as SignedQuote;
  const now = Date.parse(live.quote.deadline ?? "") - 2 * 60 * 1000;
  let calls = 0;
  const signer = new BursarGuardedSigner(null, {
    accountId: "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54",
    quote: live,
    now: () => now,
    signHash: async () => {
      calls += 1;
      return new Uint8Array(64);
    },
  });
  await assert.rejects(() => signer.signIntent({
    verifying_contract: "intents.near",
    deadline: new Date(now + 60_000).toISOString(),
    nonce: "bm9uY2UtMQ==",
    signer_id: "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54",
    intents: [{ intent: "transfer", receiver_id: "other.near", tokens: { a: "1" } }],
  } as IntentPayload), /STOP: deadline/);
  assert.equal(calls, 0);
});

test("the signer source does not read the key with the security tool", () => {
  const source = readFileSync(new URL("../src/signer.ts", import.meta.url), "utf8");
  assert.equal(source.includes("find-generic-password"), false);
  assert.equal(source.includes("security"), false);
});
