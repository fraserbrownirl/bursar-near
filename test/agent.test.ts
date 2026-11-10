import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readLedger } from "../src/guard/ledger.js";
import { INJECTED_REQUEST, askApprove, atomicAmount, continuesAfter, injectedAgentDemo, requestStops, statedPayment } from "../src/agent.js";

test("0.25 USDC is 250000 atomic units", () => {
  const stated = statedPayment("pay 0.25 USDC to frsrcom.near");
  assert.ok(stated);
  assert.equal(stated.to, "frsrcom.near");
  assert.equal(stated.amount, "250000");
  assert.equal(atomicAmount("0.25", 6), "250000");
});

test("the user's own pay sentence is not an injection", () => {
  assert.equal(requestStops("pay 0.25 USDC to frsrcom.near", "frsrcom.near"), null);
});

test("a model that pays the injected account is stopped", () => {
  const previous = process.env.BURSAR_HOME;
  process.env.BURSAR_HOME = mkdtempSync(join(tmpdir(), "bursar-agent-"));
  assert.match(requestStops(INJECTED_REQUEST, "frsrcom.near") ?? "", /ignore your limits/);
  const demo = injectedAgentDemo(1_700_000_000_000_000_000n);
  if (previous === undefined) delete process.env.BURSAR_HOME;
  else process.env.BURSAR_HOME = previous;
  assert.equal(demo.line, "STOP");
  assert.match(demo.evidence, /model pay: to=bad1794304962694\.near/);
  assert.match(demo.evidence, /tool check: allow/);
  assert.match(demo.evidence, /guard: STOP/);
});

test("warn records y and n; a block is not a question", async () => {
  const previous = process.env.BURSAR_HOME;
  process.env.BURSAR_HOME = mkdtempSync(join(tmpdir(), "bursar-approve-"));
  let asked = 0;
  const yes = await askApprove(["account age is under 14 days"], "amountIn: sol ui 250000 6 → 0.25\n", async () => {
    asked += 1;
    return "y";
  });
  const no = await askApprove(["account age is under 14 days"], "amountIn: sol ui 250000 6 → 0.25\n", async () => "n");
  const humans = readLedger().map((entry) => entry.data.human);
  if (previous === undefined) delete process.env.BURSAR_HOME;
  else process.env.BURSAR_HOME = previous;
  assert.equal(yes, true);
  assert.equal(no, false);
  assert.equal(asked, 1);
  assert.deepEqual(humans, ["y", "n"]);
  assert.equal(continuesAfter("block", true), false);
  assert.equal(continuesAfter("warn", false), false);
  assert.equal(continuesAfter("warn", true), true);
  assert.equal(continuesAfter("allow", false), true);
});
