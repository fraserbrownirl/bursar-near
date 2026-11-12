import { execFileSync } from "node:child_process";
import type { IIntentSigner, IntentPayload } from "@defuse-protocol/intents-sdk";
import { baseEncode } from "@near-js/utils";
import { KeyPair } from "near-api-js";
import { nep413Hash } from "./signer.js";

/**
 * The ed25519 account that still holds the Intents balance.
 * The key stays in the login keychain until the premium payment has landed.
 */
export function legacyInner(accountId: string): IIntentSigner {
  const raw = execFileSync("security", ["find-generic-password", "-s", `near-mainnet-${accountId}`, "-w"], { encoding: "utf8" }).trim();
  const secret = (JSON.parse(raw) as { private_key: string }).private_key;
  const key = KeyPair.fromString(secret as `ed25519:${string}`);
  const publicKey = key.getPublicKey();
  const derived = baseEncode(Buffer.from(accountId, "hex"));
  if (baseEncode(publicKey.data) !== derived) throw new Error("STOP: signer id");
  return {
    async signIntent(intent: IntentPayload) {
      const message = JSON.stringify({
        deadline: intent.deadline,
        intents: intent.intents,
        signer_id: intent.signer_id ?? accountId,
      });
      const nonce = Buffer.from(intent.nonce, "base64");
      const hash = nep413Hash({ message, nonce, recipient: intent.verifying_contract });
      const signed = key.sign(hash);
      return {
        standard: "nep413",
        payload: { message, nonce: intent.nonce, recipient: intent.verifying_contract },
        public_key: publicKey.toString(),
        signature: `ed25519:${baseEncode(signed.signature)}`,
      } as Awaited<ReturnType<IIntentSigner["signIntent"]>>;
    },
  };
}
