import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { billShare, shareOf } from "../src/bill.js";
import { readScreenshot } from "../src/screenshot.js";

const receipt = fileURLToPath(new URL("../demos/harbour-lantern.png", import.meta.url));

const read = `HARBOUR LANTERN
Table 7 • 2 guests
TOTAL USD
18.70
`;

test("a receipt total split by the guests is each person's USDC", () => {
  assert.deepEqual(billShare(read), { total: "18.70", guests: 2, each: "9.35" });
  assert.equal(shareOf("18.70", 2), "9.35");
});

test("the Harbour Lantern image is read as text, and the half is 9.35", async () => {
  const words = await readScreenshot(receipt);
  assert.match(words, /2 guests/);
  assert.match(words, /TOTAL USD/);
  assert.match(words, /18\.70/);
  assert.equal(billShare(words)?.each, "9.35");
});
