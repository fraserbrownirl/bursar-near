import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { imageFile, imageIn } from "../src/screenshot.js";

test("a dragged screenshot path is the image, and a sentence is not", () => {
  const shot = join(tmpdir(), "Screen shot 1.png");
  writeFileSync(shot, "");
  assert.equal(imageFile(`'${shot}'`), shot);
  assert.equal(imageFile(shot.replaceAll(" ", "\\ ")), shot);
  assert.equal(imageFile("pay 0.25 USDC to frsrcom.near"), null);
  assert.equal(imageIn(`split this with Maya ${shot}`), shot);
});
