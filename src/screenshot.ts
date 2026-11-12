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

/** An image path anywhere in the line. The whole line can be the path, or the path can follow a sentence. */
export function imageIn(text: string): string | null {
  const whole = imageFile(text);
  if (whole) return whole;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "/" && text.slice(i, i + 2) !== "~/") continue;
    const rest = text.slice(i);
    const ext = rest.match(/\.(?:png|jpe?g|gif|webp|heic)\b/i);
    if (!ext || ext.index === undefined) continue;
    const found = imageFile(rest.slice(0, ext.index + ext[0].length));
    if (found) return found;
  }
  return null;
}

/** Words in the image, from macOS text recognition. Empty when none were found. */
export async function readScreenshot(path: string): Promise<string> {
  const stale = !existsSync(binary) || statSync(source).mtimeMs > statSync(binary).mtimeMs;
  if (stale) await run("swiftc", ["-O", "-o", binary, source, "-framework", "Vision", "-framework", "AppKit"]);
  const { stdout } = await run(binary, [path]);
  return stdout.trim();
}
