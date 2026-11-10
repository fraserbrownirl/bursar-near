import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { intentsDec } from "../src/intents-dec.js";

test("intents dec of the generate-intent message reports the keys that are actually there", () => {
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as Record<string, unknown>;
  assert.deepEqual(Object.keys(message).sort(), ["deadline", "intents", "signer_id"]);
  const decoded = intentsDec(message);
  assert.equal(decoded.label, "reference (TypeScript)");
  assert.equal(decoded.result, "error (bad intents)\n");
});
