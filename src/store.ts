import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";

/** This app's state. It is not the Solana app's `~/.bursar`. `BURSAR_HOME` overrides it in tests. */
export const HOME_NAME = ".bursar-near";

export const dir = () => {
  const path = env("BURSAR_HOME") ?? join(homedir(), HOME_NAME);
  mkdirSync(path, { recursive: true });
  return path;
};
