import assert from "node:assert/strict";
import test from "node:test";
import { p256LowS } from "../src/signer.js";

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

test("a high S is folded under half the P-256 order", () => {
  const high = Buffer.alloc(64);
  high[32] = 0xff;
  const low = p256LowS(high);
  const before = BigInt(`0x${high.subarray(32).toString("hex")}`);
  const s = BigInt(`0x${low.subarray(32).toString("hex")}`);
  assert.ok(before > N >> 1n);
  assert.ok(s <= N >> 1n);
  assert.equal(s, N - before);
});
