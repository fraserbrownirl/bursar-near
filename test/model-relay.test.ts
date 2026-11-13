import assert from "node:assert/strict";
import test from "node:test";
import type { ModelCheck } from "../src/model-checks.js";
import {
  forwardChecks,
  listenModelRelay,
  MODEL_PORT,
  preparePayment,
  relayPort,
  submitSigned,
  type CheckBody,
  type SubmitBody,
} from "../src/model-relay.js";
import { webAuthnFields } from "../src/signer.js";
import type { BursarRequest, SignedQuote } from "../src/quote.js";

const QUOTE = "a".repeat(64);
const INTENT = "b".repeat(64);
const NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function passed(hash: string): ModelCheck {
  return {
    lines: `check → ok [live (model, Mac)] receipt ${hash}\nreference (TypeScript) → ok`,
    stop: null,
    live: true,
  };
}

function body(): CheckBody {
  return {
    quote: {} as SignedQuote,
    request: {} as BursarRequest,
    nowSec: 1,
    intent: { intent: { payload: { message: "{}", nonce: "aa", recipient: "intents.near" } } },
    accountId: "0xabc",
  };
}

test("both receipt hashes are returned only when both checks pass", async () => {
  const seen: string[] = [];
  const result = await forwardChecks(body(), {
    quote: async () => {
      seen.push("quote");
      return passed(QUOTE);
    },
    intent: async () => {
      seen.push("intent");
      return passed(INTENT);
    },
  });
  assert.deepEqual(result, { ok: true, quoteReceipt: QUOTE, intentReceipt: INTENT });
  assert.deepEqual(seen, ["quote", "intent"]);
});

test("a staged check runs only that stage, so the phone can show progress", async () => {
  const seen: string[] = [];
  const run = {
    quote: async () => {
      seen.push("quote");
      return passed(QUOTE);
    },
    intent: async () => {
      seen.push("intent");
      return passed(INTENT);
    },
  };
  assert.deepEqual(await forwardChecks({ ...body(), stage: "quote" }, run), { ok: true, quoteReceipt: QUOTE });
  assert.deepEqual(seen, ["quote"]);
  assert.deepEqual(await forwardChecks({ ...body(), stage: "intent" }, run), { ok: true, intentReceipt: INTENT });
  assert.deepEqual(seen, ["quote", "intent"]);
});

test("a quote stop is not a passing receipt and the intent check is not sent", async () => {
  let intents = 0;
  const result = await forwardChecks(body(), {
    quote: async () => ({ lines: `check → fail [live (model, Mac)] receipt ${QUOTE}`, stop: "STOP: 1click check", live: true }),
    intent: async () => {
      intents += 1;
      return passed(INTENT);
    },
  });
  assert.deepEqual(result, { ok: false, stop: "STOP: 1click check" });
  assert.equal(intents, 0);
  assert.equal("quoteReceipt" in result, false);
});

test("a model miss is not a passing receipt", async () => {
  const result = await forwardChecks(body(), {
    quote: async () => ({ lines: "reference checks only", stop: null, live: false }),
    intent: async () => passed(INTENT),
  });
  assert.deepEqual(result, { ok: false, stop: "STOP: in-model check" });
});

test("the relay refuses the model server port", () => {
  assert.equal(relayPort(8787), 8787);
  assert.throws(() => relayPort(MODEL_PORT), /STOP: model port/);
});

test("prepare returns the unsigned payload and does not call the model", async () => {
  let quotes = 0;
  const prepared = await preparePayment(
    { accountId: "0xabc", recipient: "frsrcom.near", human: "0.25", chain: "" },
    {
      nowMs: () => 1_700_000_000_000,
      rows: async () => [{ assetId: NEAR, decimals: 6, symbol: "USDC" }],
      review: () => null,
      quote: async () => {
        quotes += 1;
        return {
          signature: "00",
          timestamp: "",
          correlationId: "",
          quoteRequest: {} as SignedQuote["quoteRequest"],
          quote: { depositAddress: "deposit.near", amountIn: "250000", minAmountOut: "250000" },
        };
      },
      generate: async (deposit, signerId, exact) => {
        assert.equal(deposit, "deposit.near");
        assert.equal(signerId, "0xabc");
        exact.text = "{\"payload\":true}";
        return { intent: { payload: { message: "{}", nonce: "aa", recipient: "intents.near" } } };
      },
    },
  );
  assert.equal(quotes, 1);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.signText, "{\"payload\":true}");
  assert.equal(prepared.check.request.amount, "250000");
  assert.equal(prepared.check.request.recipient, "frsrcom.near");
});

test("a wrong token is refused and the check does not run", async () => {
  let checks = 0;
  const relay = await listenModelRelay({
    token: "phone-token",
    port: 0,
    host: "127.0.0.1",
    forward: async () => {
      checks += 1;
      return { ok: true, quoteReceipt: QUOTE, intentReceipt: INTENT };
    },
  });
  try {
    assert.notEqual(relay.port, MODEL_PORT);
    const refused = await fetch(`http://127.0.0.1:${relay.port}/check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer other" },
      body: JSON.stringify(body()),
    });
    assert.equal(refused.status, 401);
    assert.equal(checks, 0);
    const accepted = await fetch(`http://127.0.0.1:${relay.port}/check`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer phone-token" },
      body: JSON.stringify(body()),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { ok: true, quoteReceipt: QUOTE, intentReceipt: INTENT });
    assert.equal(checks, 1);
  } finally {
    await relay.close();
  }
});

function submitBody(): SubmitBody {
  const payload = "{\"signer_id\":\"0xabc\",\"verifying_contract\":\"intents.near\"}";
  const fields = webAuthnFields(payload);
  return {
    payload,
    publicKey: "p256:11111111111111111111111111111112",
    signature: "ab".repeat(64),
    clientDataJson: fields.clientDataJSON,
    authenticatorData: fields.authenticatorData,
    deposit: "deposit.near",
  };
}

test("submit binds the signature to the checked payload and returns the destination hash", async () => {
  let sent: Record<string, unknown> | null = null;
  let polls = 0;
  const result = await submitSigned(submitBody(), {
    submit: async (signedData) => {
      sent = signedData;
    },
    status: async (deposit) => {
      polls += 1;
      assert.equal(deposit, "deposit.near");
      return polls < 2
        ? { status: "PROCESSING" }
        : { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "sol-hash" }] } };
    },
    wait: async () => {},
    polls: 5,
  });
  assert.deepEqual(result, { ok: true, hash: "sol-hash" });
  assert.equal(polls, 2);
  const data = sent as unknown as { standard: string; payload: string; signature: string; client_data_json: string };
  assert.equal(data.standard, "webauthn");
  assert.equal(data.payload, submitBody().payload);
  assert.match(data.signature, /^p256:/);
  assert.equal(data.client_data_json, submitBody().clientDataJson);
});

test("submit refuses client data computed for another payload before any submit", async () => {
  let submits = 0;
  const other = webAuthnFields("{\"other\":true}");
  const result = await submitSigned({ ...submitBody(), clientDataJson: other.clientDataJSON }, {
    submit: async () => {
      submits += 1;
    },
  });
  assert.deepEqual(result, { ok: false, stop: "STOP: binding" });
  assert.equal(submits, 0);
  const bad = await submitSigned({ ...submitBody(), signature: "zz" }, { submit: async () => { submits += 1; } });
  assert.deepEqual(bad, { ok: false, stop: "STOP: signature" });
  assert.equal(submits, 0);
});

test("the relay serves /submit and a failed execution stops", async () => {
  const relay = await listenModelRelay({
    token: "phone-token",
    port: 0,
    host: "127.0.0.1",
    submit: async (body) => {
      assert.equal(body.deposit, "deposit.near");
      return { ok: false, stop: "STOP: REFUNDED" };
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${relay.port}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer phone-token" },
      body: JSON.stringify(submitBody()),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false, stop: "STOP: REFUNDED" });
  } finally {
    await relay.close();
  }
});
