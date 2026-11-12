import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { keccak256 } from "viem";
import { baseEncode } from "@near-js/utils";
import { p256LowS, versionedNonce, webAuthnFields } from "../src/signer.js";

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

test("a high S is folded under half the P-256 order", () => {
  const high = Buffer.alloc(64);
  high[32] = 0xff;
  const low = p256LowS(high);
  const before = BigInt(`0x${high.subarray(32).toString("hex")}`);
  const s = BigInt(`0x${low.subarray(32).toString("hex")}`);
  assert.ok(before > N >> 1n);
  assert.ok(s <= N >> 1n);
  assert.equal(s, N - before);
});

test("a software P-256 WebAuthn intent passes simulate_intents", async () => {
  const salt = await currentSalt();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
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
  const text = await view("current_salt", {});
  const salt = JSON.parse(text) as string;
  assert.match(salt, /^[0-9a-f]{8}$/);
  return salt;
}

async function simulate(signed: Record<string, string>): Promise<{ intents_executed: { account_id?: string }[] }> {
  const text = await view("simulate_intents", { signed: [signed] });
  return JSON.parse(text) as { intents_executed: { account_id?: string }[] };
}

async function view(method: string, args: unknown): Promise<string> {
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
