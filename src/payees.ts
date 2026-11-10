import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dir } from "./store.js";

/** Name → account id. Accepts a string or `{ "address": "..." }` from the Solana payee file. */
export function readPayeeMap(path = join(dir(), "payees.json")): Record<string, string> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[name] = value;
    else if (value && typeof value === "object" && "address" in value && typeof value.address === "string") {
      out[name] = value.address;
    }
  }
  return out;
}
