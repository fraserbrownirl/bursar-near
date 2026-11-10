import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { KeyPair, KeyType, PublicKey } from "@near-js/crypto";
import { actionCreators, createTransaction, SignedTransaction, Signature } from "@near-js/transactions";
import { ledgerHead } from "./receipt.js";

const RPC = process.env.BURSAR_NEAR_RPC ?? "https://rpc.mainnet.near.org";
const GAS = 30_000_000_000_000n;

type AccessKeyView = {
  nonce: number;
  permission: string | { FunctionCall: { receiver_id: string; method_names: string[] } };
};

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "bursar", method, params }),
  });
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result as T;
}

/**
 * Write the ledger head to the mainnet contract's `anchor` method.
 * The key is the function-call key: the account and the secret in
 * BURSAR_ANCHOR_ACCOUNT, BURSAR_ANCHOR_KEY, and the contract in
 * BURSAR_ANCHOR_CONTRACT.
 */
export async function anchorLedger(): Promise<{ head: string; hash: string; url: string }> {
  const accountId = process.env.BURSAR_ANCHOR_ACCOUNT;
  const secret = process.env.BURSAR_ANCHOR_KEY;
  const contract = process.env.BURSAR_ANCHOR_CONTRACT;
  if (!accountId || !secret || !contract) {
    throw new Error("BURSAR_ANCHOR_ACCOUNT, BURSAR_ANCHOR_KEY, and BURSAR_ANCHOR_CONTRACT are required");
  }
  const head = ledgerHead();
  if (!secret.startsWith("ed25519:") && !secret.startsWith("secp256k1:")) {
    throw new Error("BURSAR_ANCHOR_KEY must be ed25519: or secp256k1:");
  }
  const pair = KeyPair.fromString(secret as `ed25519:${string}`);
  const publicKey = pair.getPublicKey();
  const key = await rpc<AccessKeyView>("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKey.toString(),
  });
  const block = await rpc<{ header: { hash: string } }>("block", { finality: "final" });
  const tx = createTransaction(
    accountId,
    PublicKey.fromString(publicKey.toString()),
    contract,
    BigInt(key.nonce) + 1n,
    [actionCreators.functionCall("anchor", { head }, GAS, 0n)],
    base58.decode(block.header.hash),
  );
  const raw = pair.sign(createHash("sha256").update(tx.encode()).digest());
  const signature = new Signature({ keyType: secret.startsWith("ed25519:") ? KeyType.ED25519 : KeyType.SECP256K1, data: raw.signature });
  const signed = new SignedTransaction({ transaction: tx, signature });
  const bytes = Buffer.from(signed.encode()).toString("base64");
  const sent = await rpc<{ transaction: { hash: string } }>("broadcast_tx_commit", [bytes]);
  const hash = sent.transaction.hash;
  return { head, hash, url: `https://nearblocks.io/txns/${hash}` };
}
