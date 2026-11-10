import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAttacks, type Attack } from "./demo-attacks.js";

export type { Attack };
export { runAttacks };

function read(name: string): string {
  return readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8");
}

/** Every attack ends in block or STOP. No model, no key, no network. */
export function attacks(): Attack[] {
  const prevHome = process.env.BURSAR_HOME;
  const home = mkdtempSync(join(tmpdir(), "bursar-demo-"));
  process.env.BURSAR_HOME = home;
  try {
    return runAttacks({
      live: read("quote-live.json"),
      dry: read("quote-dry.json"),
      four: read("quote-4min.json"),
      generated: read("generate-intent.json"),
    });
  } finally {
    if (prevHome === undefined) delete process.env.BURSAR_HOME;
    else process.env.BURSAR_HOME = prevHome;
  }
}

export function demoReport(): { text: string; code: number } {
  const rows = attacks();
  const lines = rows.map((row) => `${row.name}: ${row.line}`);
  const code = rows.every((row) => row.expect.test(row.line)) ? 0 : 1;
  return { text: lines.join("\n"), code };
}

const isDirect = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const report = demoReport();
  process.stdout.write(report.text + "\n");
  process.exit(report.code);
}
