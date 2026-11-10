/**
 * Reference for firmware `intents dec`. The NEP-413 message from generate-intent
 * has `deadline`, `intents`, and `signer_id`. The firmware also requires
 * `verifying_contract` and `nonce`, which live on the NEP-413 envelope, not in the message.
 */
export function intentsDec(message: unknown): { result: string; label: "reference (TypeScript)" } {
  const label = "reference (TypeScript)" as const;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { result: "error (bad intents)\n", label };
  }
  const record = message as Record<string, unknown>;
  for (const key of ["signer_id", "verifying_contract", "deadline", "nonce"]) {
    if (!(key in record)) return { result: "error (bad intents)\n", label };
  }
  return { result: "ok\n", label };
}

type IntentRecord = {
  intent?: string;
  receiver_id?: string;
  tokens?: Record<string, string>;
};

/** The text `intents dec` prints for one payload. Amounts lose leading zeros. */
export function intentsDecText(payload: {
  signer_id?: unknown;
  verifying_contract?: unknown;
  deadline?: unknown;
  nonce?: unknown;
  intents?: unknown;
}): string {
  const missing = intentsDec(payload);
  if (missing.result.startsWith("error")) return missing.result.trim();
  const intents = Array.isArray(payload.intents) ? payload.intents as IntentRecord[] : [];
  const lines = [
    `signer: ${String(payload.signer_id)}`,
    `verifying-contract: ${String(payload.verifying_contract)}`,
    `deadline: ${String(payload.deadline)}`,
    `nonce: ${String(payload.nonce)}`,
    `intents: ${intents.length}`,
  ];
  intents.forEach((item, index) => {
    if (item.intent !== "transfer" || !item.receiver_id || !item.tokens) {
      lines.push(`intent[${index}]: error (unsupported)`);
      return;
    }
    const pairs = Object.entries(item.tokens).map(([token, amount]) => {
      const normalized = amount.replace(/^\+/, "").replace(/^0+(?=\d)/, "");
      return `${token}=${normalized}`;
    });
    lines.push(`intent[${index}]: transfer receiver=${item.receiver_id} tokens=${pairs.length}:${pairs.join(",")}`);
  });
  return lines.join("\n");
}
