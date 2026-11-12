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

/**
 * NEAR-native assets. 1Click's `nep141:` prefix also names foreign tokens
 * (`nep141:arb-0x….omft.near` settles on Arbitrum), so the prefix alone
 * does not mean the destination chain is NEAR.
 */
const NEAR_NATIVE = new Set([
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "nep141:wrap.near",
  "nep141:usdt.tether-token.near",
]);

/**
 * The 1Click recipient type for a payee. A NEAR account is an Intents
 * account. So is a `0x` P-256 implicit account — but only when the
 * destination asset is NEAR-native, since an `0x` address is otherwise EVM.
 */
export function recipientTypeFor(recipient: string, destinationAsset: string): "INTENTS" | "DESTINATION_CHAIN" {
  if (isNearAccount(recipient)) return "INTENTS";
  if (NEAR_NATIVE.has(destinationAsset) && /^0x[0-9a-fA-F]{40}$/.test(recipient)) return "INTENTS";
  return "DESTINATION_CHAIN";
}
