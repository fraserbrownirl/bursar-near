import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { intentsDec, intentsDecText } from "../src/intents-dec.js";

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

test("an unsupported intent replays as error (unsupported intent)", () => {
  const receipt = JSON.parse(readFileSync(new URL("../receipts/fe499e51018d86f8c96f434f7d17ab9c95ec85b6e5711ec58eed5af06f93cead.json", import.meta.url), "utf8")) as {
    inputs: { payload: string };
    output: string;
  };
  const hex = readFileSync(new URL(`../receipts/inputs/${receipt.inputs.payload}`, import.meta.url), "utf8");
  const payload = JSON.parse(Buffer.from(hex, "hex").toString("utf8")) as Parameters<typeof intentsDecText>[0];
  assert.equal(intentsDecText(payload), receipt.output);
});

test("intents dec of the full envelope names the transfer", () => {
  const generated = JSON.parse(readFileSync(new URL("./fixtures/generate-intent.json", import.meta.url), "utf8")) as {
    intent: { payload: { message: string; nonce: string; recipient: string } };
  };
  const message = JSON.parse(generated.intent.payload.message) as { signer_id: string; deadline: string; intents: unknown };
  const text = intentsDecText({
    signer_id: message.signer_id,
    verifying_contract: generated.intent.payload.recipient,
    deadline: message.deadline,
    nonce: generated.intent.payload.nonce,
    intents: message.intents,
  });
  assert.match(text, /^signer: 515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54/);
  assert.match(text, /verifying-contract: intents\.near/);
  assert.match(text, /intent\[0\]: transfer receiver=af749404b7c7bdc9482a9a378f8435a1be3bb2e6b3bc37942afe2d7c0cb0ab82 tokens=1:nep141:wrap\.near=1000000000000000000000000/);
});
