import assert from "node:assert/strict";
import test from "node:test";
import { agentStory } from "../src/demo-agents.js";
import { reportAction } from "../src/report.js";

test("two agents: an injection stop is reported, and the second agent blocks on that report", async () => {
  const previousKey = process.env.BURSAR_REPORTER_KEY;
  const previousAccount = process.env.BURSAR_REPORTER_ACCOUNT;
  delete process.env.BURSAR_REPORTER_KEY;
  delete process.env.BURSAR_REPORTER_ACCOUNT;
  const story = await agentStory();
  if (previousKey === undefined) delete process.env.BURSAR_REPORTER_KEY;
  else process.env.BURSAR_REPORTER_KEY = previousKey;
  if (previousAccount === undefined) delete process.env.BURSAR_REPORTER_ACCOUNT;
  else process.env.BURSAR_REPORTER_ACCOUNT = previousAccount;
  assert.equal(story.code, 0, story.text);
  assert.match(story.text, /agent A pay: STOP replayed/);
  assert.match(story.text, /ledger [0-9a-f]{64} replayed/);
  assert.match(story.text, /agent A report: evidence [0-9a-f]{64} replayed/);
  assert.match(story.text, /agent B pay: block: reported by agent-a\.near, evidence [0-9a-f]{64} replayed/);
});

test("a reporter call is report with no deposit", () => {
  const call = reportAction("bad.near", "ab".repeat(32));
  assert.equal(call.methodName, "report");
  assert.equal(call.attachedDeposit, 0n);
  assert.equal(call.gas, 30n * 10n ** 12n);
});
