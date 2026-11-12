import { OneClickService } from "@defuse-protocol/one-click-sdk-typescript";
import type { GeneratedIntent } from "./pay.js";

/** One USDC. A demo payment at or under this does not ask for approval. */
export const DEMO_CAP = 1_000_000n;

export function withinDemoCap(amount: string): boolean {
  return /^\d+$/.test(amount) && BigInt(amount) <= DEMO_CAP;
}

/** A 64-hex account signs NEP-413. The enclave account signs WebAuthn. */
export function signingStandard(signerId: string): "webauthn" | "nep413" {
  return /^[0-9a-f]{64}$/i.test(signerId) ? "nep413" : "webauthn";
}

/**
 * Keeps the exact generateIntent string for WebAuthn. Key order is signed.
 * A NEP-413 object is returned unchanged and the captured string is cleared.
 */
export function adoptGenerated(generated: { intent: { payload: unknown } }, exact: { text: string }): GeneratedIntent {
  if (typeof generated.intent.payload !== "string") {
    exact.text = "";
    return generated as GeneratedIntent;
  }
  exact.text = generated.intent.payload;
  const parsed = JSON.parse(exact.text) as {
    deadline: string;
    nonce: string;
    verifying_contract: string;
    signer_id: string;
    intents: unknown;
  };
  return {
    intent: {
      payload: {
        message: JSON.stringify({ deadline: parsed.deadline, intents: parsed.intents, signer_id: parsed.signer_id }),
        nonce: parsed.nonce,
        recipient: parsed.verifying_contract,
      },
    },
  };
}

export async function generateSwapIntent(depositAddress: string, signerId: string, exact: { text: string }): Promise<GeneratedIntent> {
  const generated = await OneClickService.generateIntent({
    type: "swap_transfer",
    standard: signingStandard(signerId),
    signerId,
    depositAddress,
  } as never);
  return adoptGenerated(generated as { intent: { payload: unknown } }, exact);
}
