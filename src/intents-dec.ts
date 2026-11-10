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
