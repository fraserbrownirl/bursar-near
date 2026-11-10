const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * A NEAR account id: 64 hex characters (implicit) or the named-account grammar.
 * An `0x` address is EVM. Any uppercase id is not a NEAR account (a Solana address is base58).
 */
export function isNearAccount(id: string): boolean {
  if (id.startsWith("0x") || id.startsWith("0X")) return false;
  if (/^[0-9a-f]{64}$/.test(id)) return true;
  if (id.length < 2 || id.length > 64) return false;
  if (id !== id.toLowerCase()) return false;
  return NAMED.test(id);
}
