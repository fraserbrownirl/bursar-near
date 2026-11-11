import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const source = fileURLToPath(new URL("../scripts/ocr.swift", import.meta.url));
const binary = join(tmpdir(), "bursar-ocr");

/** A dragged screenshot arrives as a file path. Quotes and escaped spaces are undone. */
export function imageFile(line: string): string | null {
  let text = line.trim();
  if (text.toLowerCase().startsWith("file://")) {
    try {
      text = decodeURIComponent(text.slice("file://".length));
    } catch {
      return null;
    }
  }
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1);
  }
  text = text.replace(/\\([ \\~'"])/g, "$1");
  if (text.startsWith("~/")) text = join(homedir(), text.slice(2));
  if (!/\.(png|jpe?g|gif|webp|heic)$/i.test(text)) return null;
  return existsSync(text) ? text : null;
}

/** Words in the image, from macOS text recognition. Empty when none were found. */
export async function readScreenshot(path: string): Promise<string> {
  const stale = !existsSync(binary) || statSync(source).mtimeMs > statSync(binary).mtimeMs;
  if (stale) await run("swiftc", ["-O", "-o", binary, source, "-framework", "Vision", "-framework", "AppKit"]);
  const { stdout } = await run(binary, [path]);
  return stdout.trim();
}
