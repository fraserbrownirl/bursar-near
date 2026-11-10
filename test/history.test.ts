import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { append } from "../src/guard/ledger.js";
import { historyCsv } from "../src/history.js";

test("history csv names the payment columns from the ledger", () => {
  const previous = process.env.BURSAR_HOME;
  process.env.BURSAR_HOME = mkdtempSync(join(tmpdir(), "bursar-history-"));
  append("settled", {
    recipient: "frsrcom.near",
    chain: "near",
    amount: "0.25",
    fee: "0",
    verdict: "allow",
    transaction: "https://nearblocks.io/txns/example",
    receipts: ["abc"],
  });
  const csv = historyCsv();
  if (previous === undefined) delete process.env.BURSAR_HOME;
  else process.env.BURSAR_HOME = previous;
  assert.match(csv, /^date,recipient,chain,amount,fee,verdict,transaction,receipts\n/);
  assert.match(csv, /,frsrcom\.near,near,0\.25,0,allow,https:\/\/nearblocks\.io\/txns\/example,abc\n/);
});
