import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ command }) => ({
  root: here,
  base: command === "build" ? "/bursar-near/" : "/",
  resolve: {
    alias: {
      "node:fs": fileURLToPath(new URL("./shims/fs.ts", import.meta.url)),
      "node:os": fileURLToPath(new URL("./shims/os.ts", import.meta.url)),
      "node:path": fileURLToPath(new URL("./shims/path.ts", import.meta.url)),
      "node:crypto": fileURLToPath(new URL("./shims/crypto.ts", import.meta.url)),
      "node:url": fileURLToPath(new URL("./shims/url.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    fs: { allow: [repo] },
  },
}));
