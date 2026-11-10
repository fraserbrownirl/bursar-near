import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { traceSha256, listReceipts, receiptHash } from "../src/receipt.js";
import { nep413Hash, referenceUi } from "../src/reference.js";
import { verifyAll } from "../src/verify.js";

test("trace hash is sha256 of uint32 little-endian ids", () => {
  assert.equal(traceSha256([1, 248320, 478642]), "da30c56fca6464cf0943bb004acc25a11bb7436b715016aa730c358448f27561");
});

test("sol ui 5000 with 6 decimals is 0.005", () => {
  assert.equal(referenceUi("5000", 6), "0.005");
});

test("NEP-413 hash is 32 bytes of hex", async () => {
  const nonce = Buffer.alloc(32, 7);
  const hash = await nep413Hash("hello", nonce, "intents.near");
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("every receipt matches its reference and its file hash", async () => {
  const rows = await verifyAll();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.verdict, "match", row.hash);
    const { receipt } = listReceipts().find((item) => item.hash === row.hash)!;
    assert.equal(receiptHash(receipt), row.hash);
  }
});

test("the sol ui 5000 6 receipt is the Locals trace", () => {
  const found = listReceipts().find((item) => item.receipt.cmd === "sol ui 5000 6");
  assert.ok(found);
  assert.equal(found.receipt.output, "0.005");
  assert.equal(found.receipt.trace_tokens, 5279);
  assert.equal(found.receipt.trace_sha256, "6d4827eb18025c05ed19a22fa792856cd058e7cc4b3a275e555046815acd9a07");
  assert.equal(found.receipt.firmware_elf_sha256, "3bc277a53d1ac9cc359201997281e9eb363665915533628dfe198e3b92609ddd");
  assert.equal(found.receipt.chip_weights_sha256, "7d756fd40e9b6c4bd36ec3f4afea44f2d04d7269c27bc841e6f4aff96007a216");
  assert.equal(found.receipt.runtime, "locals-mac");
  const raw = readFileSync(new URL(`../receipts/${found.hash}.json`, import.meta.url), "utf8");
  assert.equal(raw.endsWith("\n"), true);
});
