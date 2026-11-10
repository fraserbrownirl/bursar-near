import assert from "node:assert/strict";
import test from "node:test";
import { agentStory } from "../src/demo-agents.js";

test("two agents: an injection stop is reported, and the second agent blocks on that report", async () => {
  const story = await agentStory();
  assert.equal(story.code, 0, story.text);
  assert.match(story.text, /agent A pay: STOP/);
  assert.match(story.text, /ledger [0-9a-f]{64}/);
  assert.match(story.text, /agent A report: replayed evidence/);
  assert.match(story.text, /agent B pay: block: reported by agent-a\.testnet, evidence [0-9a-f]{64}/);
});
