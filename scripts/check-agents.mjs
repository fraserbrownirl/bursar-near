import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "AGENTS.md"), "utf8");
const failures = [];
const roots = new Set(["package.json", "README.md", "AGENTS.md", "LICENSE", "CLAUDE.md"]);

for (const token of text.matchAll(/`([^`\n]+)`/g)) {
  const name = token[1];
  if (name.startsWith("~") || name.startsWith("http") || name.startsWith("npm ") || name.includes(" ")) continue;
  if (name.includes("*")) {
    const star = name.indexOf("*");
    const dir = join(root, name.slice(0, star));
    const suffix = name.slice(name.lastIndexOf("*") + 1);
    if (!existsSync(dir) || !readdirSync(dir).some((entry) => entry.endsWith(suffix))) {
      failures.push(`no match for ${name}`);
    }
    continue;
  }
  if (!name.includes("/") && !roots.has(name)) continue;
  if (!existsSync(join(root, name))) failures.push(`missing ${name}`);
}

function fact(label) {
  const match = text.match(new RegExp(`^${label} \`([^\`]+)\``, "m"));
  if (!match) failures.push(`missing fact ${label}`);
  return match?.[1] ?? "";
}

const enclave = fact("enclave");
const accounts = JSON.parse(readFileSync(join(root, "test/fixtures/implicit-accounts.json"), "utf8"));
const p256 = accounts.find((row) => row.name === "p256")?.account;
if (enclave !== p256) failures.push(`enclave ${enclave} is not the p256 fixture ${p256}`);
const evidence = JSON.parse(readFileSync(join(root, "docs/hackathon/evidence.json"), "utf8"));
const sweep = evidence.transactions.find((row) => row.kind === "sweep");
if (enclave !== sweep?.to) failures.push(`enclave ${enclave} is not the sweep destination ${sweep?.to}`);

const home = fact("home");
const store = readFileSync(join(root, "src/store.ts"), "utf8");
const homeName = store.match(/HOME_NAME = "([^"]+)"/)?.[1];
if (home !== homeName) failures.push(`home ${home} is not HOME_NAME ${homeName}`);
if (home === ".bursar") failures.push("home is the Solana directory");

const firmware = fact("firmware");
const firmwareReadme = readFileSync(join(root, "firmware/README.md"), "utf8");
const readmeHash = firmwareReadme.match(/\| SHA-256 \| `([0-9a-f]{64})` \|/)?.[1];
const computer = readFileSync(join(root, "scripts/computer_run.py"), "utf8");
const elfHash = computer.match(/ELF_SHA256 = "([0-9a-f]{64})"/)?.[1];
if (firmware !== readmeHash || firmware !== elfHash) {
  failures.push(`firmware ${firmware} is not README ${readmeHash} or ELF_SHA256 ${elfHash}`);
}

const loaded = fact("loaded");
const verifier = readFileSync(join(root, "scripts/verify_firmware.py"), "utf8");
const loadedHash = verifier.match(/LOADED_SHA256 = "([0-9a-f]{64})"/)?.[1];
if (loaded !== loadedHash) failures.push(`loaded ${loaded} is not LOADED_SHA256 ${loadedHash}`);

if (failures.length > 0) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("agents ok\n");
