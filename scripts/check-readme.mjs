import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const failures = [];

const headings = [
  "# Bursar NEAR",
  "## Links",
  "## Verify the computer in the weights yourself",
  "## Why on-device, and why verifiable",
  "## What is real and what is simulated",
  "## The problem",
  "## Do this, see that",
  "## Tracks",
  "## How it works",
  "## Demo",
  "## What is not NEAR",
  "## Hackathon diff",
  "## Libraries",
  "## Code written with AI",
  "## Build log and roadmap",
  "## Licence",
];

const found = [...readme.matchAll(/^#{1,2} .+$/gm)].map((match) => match[0]);
let from = 0;
for (const heading of headings) {
  const at = found.indexOf(heading, from);
  if (at < 0) failures.push(`missing or out of order: ${heading}`);
  else from = at + 1;
}

function section(title, next) {
  const start = readme.indexOf(title);
  if (start < 0) return "";
  const rest = readme.slice(start + title.length);
  const end = rest.indexOf(`\n${next}`);
  return end < 0 ? rest : rest.slice(0, end);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));

function commandAllowed(command) {
  const line = command.trim();
  if (line === "npm test") return true;
  const run = line.match(/^npm run ([^\s]+)/);
  if (!run) return false;
  if (!scripts.has(run[1])) return false;
  if (run[1] !== "bursar") return true;
  return /^npm run bursar -- (check|pay|fund|demo|anchor)( |$)/.test(line);
}

function run(command) {
  const result = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: 180_000 });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const outputs = new Map();
function expectLines(command, body) {
  if (!commandAllowed(command.trim())) failures.push(`command not allowed: ${command.trim()}`);
  const key = command.trim();
  if (!outputs.has(key)) outputs.set(key, run(key));
  const got = outputs.get(key);
  for (const line of body.split("\n")) {
    if (line.trim() !== "" && !got.includes(line)) failures.push(`missing output from ${key}: ${line}`);
  }
}

function fences(body) {
  const blocks = [...body.matchAll(/```(command|output)\n([\s\S]*?)```/g)];
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i][1] !== "command") continue;
    const next = blocks[i + 1];
    if (!next || next[1] !== "output") failures.push(`command has no output fence: ${blocks[i][2].trim()}`);
    else expectLines(blocks[i][2], next[2]);
  }
}

fences(section("## Do this, see that", "## Tracks"));
fences(section("## Demo", "## What is not NEAR"));

function cited() {
  const values = new Set();
  const walk = (value) => {
    if (typeof value === "string") values.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(JSON.parse(readFileSync(join(root, "docs/hackathon/evidence.json"), "utf8")));
  return values;
}

const known = cited();
for (const url of readme.match(/https:\/\/(?:nearblocks\.io|testnet\.nearblocks\.io|explorer\.solana\.com)\/tx(?:ns)?\/[A-Za-z0-9]+/g) ?? []) {
  if (!known.has(url)) failures.push(`transaction not in evidence.json: ${url}`);
}
for (const hash of readme.match(/\b[0-9a-f]{64}\b/g) ?? []) {
  if (!known.has(hash)) failures.push(`hash not in evidence.json: ${hash}`);
}
for (const account of readme.match(/\b[a-z0-9][a-z0-9._-]*\.(?:near|testnet)\b(?!\.)/g) ?? []) {
  if (!known.has(account)) failures.push(`account not in evidence.json: ${account}`);
}

if (!existsSync(join(root, "LICENSE"))) failures.push("LICENSE is missing");

for (const name of ["HACKATHON.md", "SUBMITTING.md"]) {
  const file = readFileSync(join(root, "docs/hackathon", name), "utf8");
  const header = file.split("\n", 1)[0];
  const match = header.match(/^fetched (\S+) sha256 ([0-9a-f]{64})$/);
  if (!match) {
    failures.push(`bad snapshot header: ${name}`);
    continue;
  }
  const age = Date.now() - Date.parse(match[1]);
  if (!Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < 0) failures.push(`snapshot older than 24 hours: ${name}`);
  const body = file.slice(header.length + 2);
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== match[2]) failures.push(`snapshot hash mismatch: ${name}`);
}

if (failures.length > 0) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("check:readme ok\n");
