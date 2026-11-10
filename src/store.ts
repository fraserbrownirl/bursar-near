import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** State directory. `BURSAR_HOME` overrides it (tests use a temporary one). */
export const dir = () => {
  const path = process.env.BURSAR_HOME ?? join(homedir(), ".bursar");
  mkdirSync(path, { recursive: true });
  return path;
};
