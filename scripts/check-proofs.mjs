import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// Proofs are consistent or the gate is red:
// - every payment scene is demos/<scene>.md with the four sections in order,
//   and one row in the demos/README.md index;
// - every attack is attacks/<id>.yaml plus one row in attacks/README.md whose
//   receipt cell is a tracked receipt or "none", and whose clip cell is a
//   tracked file or "none";
// - every receipt hash and transaction URL a proof page cites is in
//   docs/hackathon/evidence.json.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const tracked = new Set(
  spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean),
);

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

const SECTIONS = ["## What it is", "## What's real", "## What's staged", "## How it's proven"];
const INDEX = readFileSync(join(root, "demos/README.md"), "utf8");

const scenePages = [];
for (const match of INDEX.matchAll(/\]\((?!http)([a-z0-9-]+\/README\.md)\)/g)) {
  scenePages.push(match[1]);
}
for (const page of scenePages) {
  const file = `demos/${page}`;
  if (!tracked.has(file)) {
    failures.push(`index page not tracked: ${file}`);
    continue;
  }
  const text = readFileSync(join(root, file), "utf8");
  let from = -1;
  for (const heading of SECTIONS) {
    const at = text.indexOf(heading);
    if (at < 0) failures.push(`${file}: missing section "${heading}"`);
    else if (at < from) failures.push(`${file}: "${heading}" is out of order`);
    else from = at;
  }
}

import { readdirSync, statSync } from "node:fs";
for (const name of readdirSync(join(root, "demos"))) {
  const dir = join(root, "demos", name);
  if (name.endsWith(".md") && name !== "README.md" && name !== "runsheet.md") {
    failures.push(`demos/${name} is a loose proof page; scenes are folders with a README.md`);
    continue;
  }
  if (!statSync(dir).isDirectory() || name === "takes") continue;
  const page = `${name}/README.md`;
  if (existsSync(join(dir, "README.md")) && !scenePages.includes(page)) {
    failures.push(`demos/${page} is a scene page but is not in the index`);
  }
}

const proofFiles = ["attacks/README.md", "demos/README.md", "llms.txt", "demos/runsheet.md", ...scenePages.map((page) => `demos/${page}`)].filter((file) => existsSync(join(root, file)));

const attacks = readFileSync(join(root, "attacks/README.md"), "utf8");
let rowNumber = 0;
for (const line of attacks.split("\n")) {
  if (!line.startsWith("|") || line.includes("| --- |") || line.includes("| attack |")) continue;
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length < 9) continue;
  rowNumber += 1;
  const [attackCell, , , , , receiptCell, clipCell] = cells.slice(1);
  const yaml = attackCell.match(/\]\(([^)]+)\)/)?.[1];
  if (!yaml || !tracked.has(`attacks/${yaml}`)) failures.push(`attack row ${rowNumber}: missing scenario ${yaml}`);
  if (receiptCell !== "none") {
    const hash = receiptCell.match(/\b[0-9a-f]{64}\b/)?.[0];
    if (!hash || !tracked.has(`receipts/${hash}.json`)) failures.push(`attack row ${rowNumber}: receipt is not a tracked receipt: ${receiptCell.slice(0, 24)}`);
  }
  if (clipCell !== "none") {
    const clip = clipCell.match(/\]\(([^)]+)\)/)?.[1];
    if (!clip || !tracked.has(posix.normalize(posix.join("attacks", clip)))) failures.push(`attack row ${rowNumber}: clip is not a tracked file: ${clip}`);
  }
}
for (const name of readdirSync(join(root, "attacks"))) {
  if (!name.endsWith(".yaml")) continue;
  if (!attacks.includes(`(${name})`)) failures.push(`attacks/${name} has no row in attacks/README.md`);
}

const TX_URL = /https:\/\/(?:nearblocks\.io|testnet\.nearblocks\.io|explorer\.solana\.com|basescan\.org|arbiscan\.io)\/tx(?:ns)?\/[A-Za-z0-9x]+/g;
for (const file of proofFiles) {
  const text = readFileSync(join(root, file), "utf8");
  for (const hash of text.match(/\b[0-9a-f]{64}\b/g) ?? []) {
    if (!known.has(hash)) failures.push(`hash not in evidence.json (${file}): ${hash}`);
  }
  for (const url of text.match(TX_URL) ?? []) {
    if (!known.has(url)) failures.push(`transaction not in evidence.json (${file}): ${url}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("check:proofs ok\n");
