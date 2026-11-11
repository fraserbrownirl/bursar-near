import { execFileSync } from "node:child_process";
import { connect, keyStores, KeyPair } from "near-api-js";

const accountId = "515ead208df187f146f2ae5f7e24522cf2ca977df95bdee7bb5f957bbe142c54";
const deposit = "d0b5b4ec49bcded6882649388228a411c77652b45495d641aee8d2cafa55fed9";
const amountIn = "42321341167365862085446";
const raw = execFileSync("security", ["find-generic-password", "-s", `near-mainnet-${accountId}`, "-w"], { encoding: "utf8" }).trim();
const secret = (JSON.parse(raw) as { private_key: string }).private_key;
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey("mainnet", accountId, KeyPair.fromString(secret as `ed25519:${string}`));
const near = await connect({
  networkId: "mainnet",
  nodeUrl: process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org",
  keyStore,
} as never);
const account = await near.account(accountId);
const gas = 30n * 10n ** 12n;
const stored = await account.functionCall({
  contractId: "wrap.near",
  methodName: "storage_deposit",
  args: { account_id: deposit },
  gas,
  attachedDeposit: 1_250_000_000_000_000_000_000n,
}) as { transaction: { hash: string } };
console.log("storage", stored.transaction.hash);
const sent = await account.functionCall({
  contractId: "wrap.near",
  methodName: "ft_transfer",
  args: { receiver_id: deposit, amount: amountIn },
  gas,
  attachedDeposit: 1n,
}) as { transaction: { hash: string } };
console.log("transfer", sent.transaction.hash);
