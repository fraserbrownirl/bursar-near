import type { SignedQuote } from "./quote.js";

/**
 * The eleven intent types in
 * near/intents contracts/defuse/core/src/intents/mod.rs
 * (the `imt` feature's mint and burn are not in that list).
 * https://github.com/near/intents/blob/main/contracts/defuse/core/src/intents/mod.rs
 */
export const INTENT_TYPES = [
  "add_public_key",
  "remove_public_key",
  "transfer",
  "ft_withdraw",
  "nft_withdraw",
  "mt_withdraw",
  "native_withdraw",
  "storage_deposit",
  "token_diff",
  "set_auth_by_predecessor_id",
  "auth_call",
] as const;

export type IntentRecord = Record<string, unknown> & { intent?: string };

export type IntentPayload = { intents?: IntentRecord[] };

/** The one transfer Bursar is willing to sign for this quote. */
export function expectedTransfer(response: SignedQuote): IntentRecord {
  const memo = response.quote.depositMemo;
  const intent: IntentRecord = {
    intent: "transfer",
    receiver_id: response.quote.depositAddress,
    tokens: { [response.quoteRequest.originAsset]: response.quote.amountIn },
  };
  if (memo) intent.memo = memo;
  return intent;
}

/**
 * Allow exactly one transfer to the quote's deposit address, for amountIn of originAsset.
 * Anything else STOPs, and the line names what differed.
 */
export function inspectIntent(payload: IntentPayload, response: SignedQuote): string | null {
  const intents = payload.intents;
  if (!intents || intents.length !== 1) return `STOP: ${intents?.length ?? 0} intents`;
  const intent = intents[0]!;
  if (intent.intent !== "transfer") return `STOP: intent ${String(intent.intent)}`;
  if (intent.receiver_id !== response.quote.depositAddress) {
    return `STOP: receiver_id ${String(intent.receiver_id)}`;
  }
  const tokens = intent.tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return "STOP: tokens";
  const entries = Object.entries(tokens as Record<string, unknown>);
  if (entries.length !== 1) return `STOP: ${entries.length} tokens`;
  const [asset, amount] = entries[0]!;
  if (asset !== response.quoteRequest.originAsset) return `STOP: token ${asset}`;
  if (String(amount) !== response.quote.amountIn) return `STOP: token amount ${String(amount)}`;
  if ("msg" in intent || "min_gas" in intent) return "STOP: notification";
  const memo = response.quote.depositMemo;
  if (memo) {
    if (intent.memo !== memo) return "STOP: memo";
  } else if ("memo" in intent && intent.memo != null && intent.memo !== "") {
    return "STOP: memo";
  }
  return null;
}
