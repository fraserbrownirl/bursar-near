import { connect, keyStores, KeyPair } from "near-api-js";

/** 30 TGas. The function-call key's allowance must cover this at the buy price, before the refund. */
export const REPORT_GAS = 30n * 10n ** 12n;

export type ReportArgs = {
  account: string;
  reason: string;
  evidence_hash: string;
};

/** The only call a reporter key can make. Deposit is zero: a function-call key cannot attach NEAR. */
export function reportAction(account: string, evidenceHash: string): {
  methodName: "report";
  args: ReportArgs;
  gas: bigint;
  attachedDeposit: bigint;
} {
  return {
    methodName: "report",
    args: { account, reason: "injection", evidence_hash: evidenceHash },
    gas: REPORT_GAS,
    attachedDeposit: 0n,
  };
}

/** Signs `report` with the key it is given and returns the mainnet explorer link. The key is not written to disk. */
export async function sendReport(options: {
  contractId: string;
  signerId: string;
  secret: string;
  account: string;
  evidenceHash: string;
}): Promise<string> {
  const action = reportAction(options.account, options.evidenceHash);
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("mainnet", options.signerId, KeyPair.fromString(options.secret as `ed25519:${string}`));
  // Node16 resolves @near-js/wallet-account to a .cjs file with no declarations, so ConnectConfig
  // only keeps keyPath. The fields below are the ones connect() reads.
  const near = await connect({
    networkId: "mainnet",
    nodeUrl: process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org",
    keyStore,
  } as never);
  const signer = await near.account(options.signerId);
  const outcome = await signer.functionCall({
    contractId: options.contractId,
    methodName: action.methodName,
    args: action.args,
    gas: action.gas,
    attachedDeposit: action.attachedDeposit,
  }) as { transaction: { hash: string } };
  return `https://nearblocks.io/txns/${outcome.transaction.hash}`;
}
