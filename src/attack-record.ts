import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attackHome, loadScenarios, scenarioPort, stoppedIn, type AttackScenario } from "./attack-demo.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const takesDir = join(root, "attacks/takes");

/** Largest Menlo size at which a 64-hex quote-signature line stays on one line in VHS at 1920 wide. Measured from a calibration tape: 32 wraps, 31 does not. */
export const FONT_SIZE = 31;

/** Columns that fit at FONT_SIZE in the VHS frame. The evidence line is 96 characters and fits. */
export const COLUMNS = 96;

export function evidenceLineFits(fontSize: number, padding = 8): boolean {
  const line = `check: quote-signature receipt: ${"a".repeat(64)}`;
  const usable = 1920 - padding * 2;
  return line.length * fontSize * 0.6 <= usable;
}

function vhsType(line: string): string {
  if (line.includes("`")) return `Type "${line.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
  if (line.includes("\"")) return "Type `" + line + "`";
  return `Type "${line}"`;
}

function fontFromEnv(): number {
  const font = Number(process.env.BURSAR_TAKE_FONT);
  return Number.isInteger(font) && font >= 12 && font <= 72 ? font : FONT_SIZE;
}

/** A tape of one scenario. In-model checks wait 180s. Model replies and the ready line wait 60s. */
export function tapeFor(scenario: AttackScenario, output: string, fontSize = fontFromEnv()): string {
  const timeout = stoppedIn(scenario) === "code" ? "60s" : "180s";
  const url = scenario.merchant ? `http://127.0.0.1:${scenarioPort(scenario.id)}/` : "";
  const qr = scenario.qr ? join(attackHome(scenario.id), "attack.png") : "";
  const lines = [
    `Output "${output}"`,
    `Set Shell bash`,
    `Set FontFamily "Menlo"`,
    `Set FontSize ${fontSize}`,
    `Set Width 1920`,
    `Set Height 1080`,
    `Set Padding 8`,
    `Set Framerate 30`,
    ...(fontSize === FONT_SIZE ? [] : [`Set TypingSpeed 25ms`]),
    `Hide`,
    `Type "cd ${root} && npx tsx src/attack-demo.ts --session ${scenario.id}"`,
    `Enter`,
    `Wait+Screen@60s /I am ready\\./`,
    `Sleep 300ms`,
    `Show`,
  ];
  const turns = scenario.agent ? [scenario.agent] : scenario.turns;
  let waitedForPrompt = false;
  for (const turn of turns) {
    if (waitedForPrompt) lines.push(`Wait+Screen@120s /(?m)^> ?$/`, "Sleep 300ms");
    waitedForPrompt = true;
    const typed = turn.replaceAll("{url}", url).replaceAll("{qr}", qr ? "attack.png" : "");
    for (const line of typed.split("\n")) {
      lines.push(vhsType(line));
      lines.push("Enter");
    }
  }
  lines.push(`Wait+Screen@${timeout} /check: ${scenario.check} receipt:/`);
  lines.push("Sleep 1s");
  return `${lines.join("\n")}\n`;
}

function existingTake(version: number, id: string): string | null {
  if (!existsSync(takesDir)) return null;
  const found = readdirSync(takesDir).filter((name) => name.startsWith(`v${version}-${id}-t`) && name.endsWith(".mp4"));
  for (const name of found) {
    const path = join(takesDir, name);
    if (probeDuration(path) !== null) return path;
  }
  return null;
}

function nextTake(version: number, id: string): string {
  return join(takesDir, `v${version}-${id}-t${Date.now().toString(36)}.mp4`);
}

export function probeDuration(file: string): number | null {
  if (!existsSync(file)) return null;
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function versionNow(): number {
  const fromEnv = Number(process.env.BURSAR_TAKE_VERSION);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  let n = 1;
  while (existsSync(join(root, "attacks/video", `attacks-v${n}.mp4`))) n += 1;
  return n;
}

/** Record each scenario off-screen. A failed take is re-shot under a new name. */
export async function recordAttacks(only = ""): Promise<void> {
  if (!evidenceLineFits(FONT_SIZE)) throw new Error(`font ${FONT_SIZE} does not fit the evidence line`);
  mkdirSync(takesDir, { recursive: true });
  const directory = fileURLToPath(new URL("../attacks/", import.meta.url));
  const scenarios = loadScenarios(directory).filter((scenario) => !only || scenario.id === only);
  const version = versionNow();
  for (const scenario of scenarios) {
    let recorded = existingTake(version, scenario.id) ?? "";
    if (recorded) {
      process.stdout.write(`take ${recorded} kept\n`);
      continue;
    }
    for (let attempt = 0; attempt < 3 && !recorded; attempt += 1) {
      const output = nextTake(version, scenario.id);
      const tape = join(takesDir, `${scenario.id}.tape`);
      writeFileSync(tape, tapeFor(scenario, output));
      spawnSync("vhs", [tape], { stdio: "inherit" });
      const duration = probeDuration(output);
      if (duration === null) {
        process.stderr.write(`re-shoot ${scenario.id}: ${output} has no duration\n`);
        continue;
      }
      process.stdout.write(`take ${output} ${duration}s\n`);
      recorded = output;
    }
    if (!recorded) throw new Error(`no take for ${scenario.id}`);
  }
}

const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invoked) {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] ?? "" : "";
  await recordAttacks(only);
}
