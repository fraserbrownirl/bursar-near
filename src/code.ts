import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create, toBuffer } from "qrcode";
import { PNG } from "pngjs";
import { isNearAccount } from "./account.js";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr") as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const render = {
  errorCorrectionLevel: "M" as const,
  margin: 4,
  color: { dark: "#000000ff", light: "#ffffffff" },
};

function moduleOn(modules: { size: number; get: (row: number, col: number) => boolean }, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= modules.size || col >= modules.size) return false;
  return Boolean(modules.get(row, col));
}

/**
 * Half-block QR. One module is one character wide, and two module rows share
 * a line, so the code stays square in a terminal and does not wrap. Blocks
 * are the light modules, so the code reads dark-on-light on a black terminal,
 * the way a phone camera and jsQR scan it.
 */
export function terminalQr(text: string, columns = process.stdout.columns || 80): string {
  const symbol = create(text, { errorCorrectionLevel: "M" });
  const modules = symbol.modules;
  const quiet = 4;
  const span = modules.size + quiet * 2;
  const scale = Math.max(1, Math.min(2, Math.floor((Math.max(columns, span) - 1) / span)));
  const lines: string[] = [];
  for (let row = 0; row < span; row += 2) {
    let line = "";
    for (let col = 0; col < span; col += 1) {
      const top = moduleOn(modules, row - quiet, col - quiet);
      const bottom = moduleOn(modules, row - quiet + 1, col - quiet);
      const glyph = top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
      line += glyph.repeat(scale);
    }
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

/** PNG bytes and a terminal drawing. The QR payload is `text` alone. */
export async function encode(text: string): Promise<{ png: Buffer; terminal: string }> {
  const png = await toBuffer(text, { ...render, type: "png", scale: 20 });
  return { png, terminal: terminalQr(text) };
}

/** The payment code in the terminal, and as `bursar-code.png` in `dir`. The PNG path prints under the code. */
export async function writeAccountCode(accountId: string, dir = process.cwd()): Promise<string> {
  const drawn = await encode(accountId);
  const file = join(dir, "bursar-code.png");
  writeFileSync(file, drawn.png);
  return `${drawn.terminal}${file}\n`;
}

export function qrText(png: Buffer): string {
  const image = PNG.sync.read(png);
  const pixels = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const found = jsQR(pixels, image.width, image.height);
  if (!found) throw new Error("STOP: qr");
  return found.data;
}

/** The Vision helper, built from `scripts/ocr.swift`. The text is untrusted. */
export function imageText(path: string): Promise<string> {
  const binary = fileURLToPath(new URL("../scripts/ocr", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [path], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", () => reject(new Error("STOP: ocr")));
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8").trim();
      if (code !== 0 || !text) {
        reject(new Error(Buffer.concat(err).toString("utf8").trim() || "STOP: ocr"));
        return;
      }
      resolve(text);
    });
  });
}

/** A NEAR account, or the enclave account (`0x` and 40 hex). Anything else is `STOP: account`. */
export function decode(png: Buffer): string {
  const text = qrText(png);
  if (isNearAccount(text) || /^0x[0-9a-fA-F]{40}$/.test(text)) return text;
  return "STOP: account";
}
