import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";

/** State directory. `BURSAR_HOME` overrides it (tests use a temporary one). */
export const dir = () => {
  const path = env("BURSAR_HOME") ?? join(homedir(), ".bursar");
  mkdirSync(path, { recursive: true });
  return path;
};
