import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadBlocklist } from "../src/blocklist.js";
import { fetchLiveOrRecorded } from "../src/recorded-fetch.js";

const BAD = "bad1794304962694.near";
const HASH = "9766ad071b88e505dad7418a95d0aa157fec8c9e9517a763b674689ef45bb992";

test("a thrown fetch uses the recorded body, and an HTTP response does not", async () => {
  const recorded = await fetchLiveOrRecorded(async () => {
    throw new TypeError("Failed to fetch");
  }, "https://api.nearblocks.io/v1/account/wrap.near", undefined, "{\"txns\":[{\"count\":\"4\"}]}");
  assert.equal(recorded.recorded, true);
  assert.equal(await recorded.response.text(), "{\"txns\":[{\"count\":\"4\"}]}");

  const live = await fetchLiveOrRecorded(async () => new Response("live", { status: 503 }), "https://rpc.mainnet.near.org", undefined, "recorded");
  assert.equal(live.recorded, false);
  assert.equal(await live.response.text(), "live");

  await assert.rejects(() => fetchLiveOrRecorded(async () => {
    throw new TypeError("Failed to fetch");
  }, "https://api.nearblocks.io/v1/account/other.near", undefined, undefined));
});

test("the recorded testnet get is the report behind the testnet transaction", async () => {
  const previousContract = process.env.BURSAR_BLOCKLIST_CONTRACT;
  const previousRpc = process.env.BURSAR_BLOCKLIST_RPC;
  process.env.BURSAR_BLOCKLIST_CONTRACT = "bursar-rep-7f1d8a2b.testnet";
  process.env.BURSAR_BLOCKLIST_RPC = "https://rpc.testnet.near.org";
  try {
    const body = readFileSync(new URL("./fixtures/blocklist.get-bad1794304962694.near.json", import.meta.url), "utf8");
    const loaded = await loadBlocklist(BAD, async () => new Response(body, { status: 200 }));
    const report = loaded.accounts[BAD]?.[0];
    assert.equal(loaded.missing, false);
    assert.equal(report?.reporter, "bursar-rep-7f1d8a2b.testnet");
    assert.equal(report?.reason, "injection");
    assert.equal(report?.evidenceHash, HASH);
  } finally {
    if (previousContract === undefined) delete process.env.BURSAR_BLOCKLIST_CONTRACT;
    else process.env.BURSAR_BLOCKLIST_CONTRACT = previousContract;
    if (previousRpc === undefined) delete process.env.BURSAR_BLOCKLIST_RPC;
    else process.env.BURSAR_BLOCKLIST_RPC = previousRpc;
  }
});
