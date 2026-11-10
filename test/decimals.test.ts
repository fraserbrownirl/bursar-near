import assert from "node:assert/strict";
import test from "node:test";
import { decimalsFor, readTokenFile } from "../src/decimals.js";
import { fileURLToPath } from "node:url";

const NATIVE_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

test("native USDC from the recorded 1Click token list has 6 decimals", () => {
  const rows = readTokenFile(fileURLToPath(new URL("./fixtures/tokens.json", import.meta.url)));
  assert.equal(decimalsFor(NATIVE_USDC, rows), 6);
});

test("an asset missing from the token list stops", () => {
  assert.throws(() => decimalsFor("nep141:not-a-token.near", []), /STOP: unknown decimals/);
});
