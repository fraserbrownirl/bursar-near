import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { INJECTED_REQUEST } from "../src/agent.js";
import { append } from "../src/guard/ledger.js";
import { handleMcp } from "../src/mcp.js";

test("mcp lists the four tools and returns an injection as a tool error", async () => {
  const listed = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = ((listed?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
  assert.deepEqual(names, ["pay", "check", "balance", "history"]);
  const refused = await handleMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "pay", arguments: { request: INJECTED_REQUEST } },
  });
  const result = refused?.result as { isError: boolean; content: { text: string }[] };
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? "", /STOP/);
});

test("mcp history is the ledger csv", async () => {
  const previous = process.env.BURSAR_HOME;
  process.env.BURSAR_HOME = mkdtempSync(join(tmpdir(), "bursar-mcp-"));
  append("settled", { recipient: "frsrcom.near", chain: "near", amount: "0.25", fee: "0", verdict: "allow", transaction: "", receipts: [] });
  const response = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "history", arguments: {} } });
  if (previous === undefined) delete process.env.BURSAR_HOME;
  else process.env.BURSAR_HOME = previous;
  const result = response?.result as { isError: boolean; content: { text: string }[] };
  assert.equal(result.isError, false);
  assert.match(result.content[0]?.text ?? "", /frsrcom\.near,near,0\.25/);
});
