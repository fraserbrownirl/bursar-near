import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) {
  process.stderr.write("usage: node scripts/build-phone-js.mjs <out.js>\n");
  process.exit(2);
}
const shim = (name) => join(root, "web", "shims", name);

await esbuild.build({
  entryPoints: [join(root, "phone", "hear.ts")],
  bundle: true,
  format: "iife",
  globalName: "BursarHear",
  outfile: out,
  platform: "browser",
  target: "es2020",
  alias: {
    "node:fs": shim("fs.ts"),
    "node:os": shim("os.ts"),
    "node:path": shim("path.ts"),
    "node:crypto": shim("crypto.ts"),
    "node:url": shim("url.ts"),
  },
  banner: {
    js: `if (typeof TextEncoder === "undefined") {
  globalThis.TextEncoder = class {
    encode(text) {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
      return bytes;
    }
  };
}
globalThis.process = globalThis.process || { env: {} };`,
  },
  footer: {
    js: "globalThis.bursarHearJson = (text) => JSON.stringify(BursarHear.hear(text));",
  },
});
