import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decode, encode, terminalQr } from "../src/code.js";

const IMPLICIT = "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54";
const root = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));

async function png(text: string): Promise<string> {
  const drawn = await encode(text);
  const file = join(mkdtempSync(join(tmpdir(), "bursar-code-")), "bursar-code.png");
  writeFileSync(file, drawn.png);
  return file;
}

function scan(file: string) {
  return spawnSync(process.execPath, [tsx, "src/cli.ts", "scan", file], {
    cwd: root,
    encoding: "utf8",
  });
}

test("a Solana payment QR fits a normal terminal without wrapping", () => {
  const uri = "solana:BHQBpzsUNHzhZfD2jrxwwcp1FcduvdLjTh5x4DkzvEkp?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=0.15";
  const drawn = terminalQr(uri, 80);
  const lines = drawn.replace(/\n$/, "").split("\n");
  const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").length;
  assert.ok(lines.every((line) => visible(line) === visible(lines[0] ?? "") && visible(line) <= 80));
  assert.match(drawn, /\x1b\[47m/);
  assert.match(drawn, /\x1b\[40m/);
  const wide = terminalQr(uri, 120);
  assert.match(visible(wide.split("\n")[0] ?? "") === 106 ? wide : "", /./);
});

test("a QR of frsrcom.near decodes to that account", async () => {
  const drawn = await encode("frsrcom.near");
  assert.match(drawn.terminal, /\x1b\[4[07]m/);
  const file = join(mkdtempSync(join(tmpdir(), "bursar-code-")), "bursar-code.png");
  writeFileSync(file, drawn.png);
  assert.equal(decode(readFileSync(file)), "frsrcom.near");
  const run = scan(file);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, "frsrcom.near\n");
});

test("a QR of an implicit account decodes to that account", async () => {
  const file = await png(IMPLICIT);
  assert.equal(decode(readFileSync(file)), IMPLICIT);
  const run = scan(file);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, `${IMPLICIT}\n`);
});

test("a QR of the enclave account decodes to that account", async () => {
  const account = "0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b";
  const file = await png(account);
  assert.equal(decode(readFileSync(file)), account);
  const run = scan(file);
  assert.equal(run.status, 0);
  assert.equal(run.stdout, `${account}\n`);
});

test("a QR of a URL is STOP: account", async () => {
  const file = await png("https://example.com");
  assert.equal(decode(readFileSync(file)), "STOP: account");
  const run = scan(file);
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "STOP: account\n");
});
