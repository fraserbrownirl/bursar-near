/** Digit string of a NEAR nanosecond timestamp. JSON numbers round these. */
export function parseCreatedNs(raw: string): string | null {
  const created = raw.match(/"created"\s*:\s*\{[^}]*"block_timestamp"\s*:\s*"?(\d+)"?/);
  return created?.[1] ?? null;
}

/** Latest deployment timestamp in the raw body, as a digit string. */
export function parseLatestDeployNs(raw: string): string | null {
  const found = [...raw.matchAll(/"block_timestamp"\s*:\s*"?(\d+)"?/g)].map((match) => match[1]!);
  if (found.length === 0) return null;
  return found.reduce((max, item) => (BigInt(item) > BigInt(max) ? item : max));
}

/** Outgoing transaction count from a txns-only count body. */
export function parseOutgoingCount(raw: string): string | null {
  const count = raw.match(/"count"\s*:\s*"?(\d+)"?/);
  return count?.[1] ?? null;
}

/** `code_hash` from a NEAR RPC `view_account` response. */
export function parseCodeHash(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const result = (parsed as { result?: { code_hash?: unknown } }).result;
  return typeof result?.code_hash === "string" ? result.code_hash : null;
}
