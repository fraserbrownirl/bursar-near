import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { baseEncode } from "@near-js/utils";
import { keccak256 } from "viem";
import { signatureOk, type SignedQuote } from "../src/quote.js";
import { p256LowS, versionedNonce, webAuthnFields } from "../src/signer.js";

const live = process.env.LIVE_TESTS === "1";

test("live quote and an RPC account read", { skip: live ? false : "set LIVE_TESTS=1" }, async () => {
  const account = process.env.BURSAR_NEAR_ACCOUNT;
  assert.ok(account, "BURSAR_NEAR_ACCOUNT is the refund and recipient account");
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    depositType: "INTENTS",
    originAsset: "nep141:wrap.near",
    destinationAsset: "nep141:usdt.tether-token.near",
    amount: "1000000000000000000000000",
    recipient: account,
    recipientType: "INTENTS",
    refundTo: account,
    refundType: "INTENTS",
    slippageTolerance: 100,
    deadline: "2026-11-12T00:00:00Z",
  };
  const quoteResponse = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(quoteResponse.status, 201);
  const quote = await quoteResponse.json() as SignedQuote;
  assert.equal(signatureOk(quote), true);

  const rpc = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "dontcare",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: "frol.near" },
    }),
  });
  const view = await rpc.json() as { result?: { code_hash?: string } };
  assert.equal(view.result?.code_hash, "11111111111111111111111111111111");
});

test("a software P-256 WebAuthn intent passes simulate_intents", async () => {
  const salt = await currentSalt();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  assert.equal(raw.length, 64);
  const hash = Buffer.from(keccak256(Buffer.concat([Buffer.from("p256"), raw])).slice(2), "hex");
  const account = `0x${hash.subarray(12).toString("hex")}`;
  const deadlineMs = Date.now() + 10 * 60 * 1000;
  const nonce = versionedNonce(salt, deadlineMs + 30 * 60 * 1000, randomBytes(15));
  const payload = JSON.stringify({
    signer_id: account,
    verifying_contract: "intents.near",
    deadline: new Date(deadlineMs).toISOString(),
    nonce: nonce.toString("base64"),
    intents: [],
  });
  const fields = webAuthnFields(payload);
  const message = Buffer.from(fields.messageHex, "hex");
  const signature = p256LowS(createSign("SHA256").update(message).sign({ key: privateKey, dsaEncoding: "ieee-p1363" }));
  const signed = {
    standard: "webauthn",
    payload,
    public_key: `p256:${baseEncode(raw)}`,
    signature: `p256:${baseEncode(signature)}`,
    client_data_json: fields.clientDataJSON,
    authenticator_data: fields.authenticatorData,
  };
  const simulated = await simulate(signed);
  assert.equal(simulated.intents_executed[0]?.account_id, account);
  assert.equal(createHash("sha256").update(payload).digest("base64url"), JSON.parse(fields.clientDataJSON).challenge);
});

async function currentSalt(): Promise<string> {
  const text = await viewCall("current_salt", {});
  const salt = JSON.parse(text) as string;
  assert.match(salt, /^[0-9a-f]{8}$/);
  return salt;
}

async function simulate(signed: Record<string, string>): Promise<{ intents_executed: { account_id?: string }[] }> {
  const text = await viewCall("simulate_intents", { signed: [signed] });
  return JSON.parse(text) as { intents_executed: { account_id?: string }[] };
}

async function viewCall(method: string, args: unknown): Promise<string> {
  const response = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "intents.near",
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = await response.json() as { result?: { result?: number[]; error?: string } };
  if (!body.result?.result) throw new Error(body.result?.error ?? "simulate");
  return Buffer.from(body.result.result).toString("utf8");
}
