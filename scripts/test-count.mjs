import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const files = pkg.scripts.test.split(/\s+/).filter((word) => word.endsWith(".ts"));
const reporter = join(root, "scripts", "count-reporter.mjs");
const run = spawnSync("npx", ["tsx", "--test", `--test-reporter=${reporter}`, ...files], {
  cwd: root,
  encoding: "utf8",
});
const line = (run.stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "";
const count = JSON.parse(line);
if (run.status !== 0 || count.fail !== 0 || count.cancelled !== 0 || count.skipped !== 0 || count.todo !== 0) {
  process.stderr.write(run.stderr ?? "");
  process.stderr.write(line + "\n");
  process.exit(run.status || 1);
}
const out = process.argv[2];
const body = JSON.stringify(count);
if (out) writeFileSync(out, body + "\n");
else process.stdout.write(body + "\n");
