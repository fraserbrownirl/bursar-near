import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { toBuffer, toString } from "qrcode";
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

/** PNG bytes and a terminal drawing. The QR payload is `text` alone. */
export async function encode(text: string): Promise<{ png: Buffer; terminal: string }> {
  const png = await toBuffer(text, { ...render, type: "png", scale: 4 });
  const terminal = await toString(text, { errorCorrectionLevel: "M", type: "utf8", margin: 2 });
  return { png, terminal };
}

/** The owner's account as a QR in the terminal, and `bursar-code.png` in `dir`. */
export async function writeAccountCode(accountId: string, dir = process.cwd()): Promise<string> {
  const drawn = await encode(accountId);
  writeFileSync(join(dir, "bursar-code.png"), drawn.png);
  return drawn.terminal.endsWith("\n") ? drawn.terminal : `${drawn.terminal}\n`;
}

export function qrText(png: Buffer): string {
  const image = PNG.sync.read(png);
  const pixels = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  const found = jsQR(pixels, image.width, image.height);
  if (!found) throw new Error("STOP: qr");
  return found.data;
}

/** A NEAR account, or the enclave account (`0x` and 40 hex). Anything else is `STOP: account`. */
export function decode(png: Buffer): string {
  const text = qrText(png);
  if (isNearAccount(text) || /^0x[0-9a-fA-F]{40}$/.test(text)) return text;
  return "STOP: account";
}
