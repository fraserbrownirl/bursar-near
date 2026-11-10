import { parseCodeHash, parseCreatedNs, parseLatestDeployNs, parseOutgoingCount } from "./parse.js";
import { NEAR_RPC, NEARBLOCKS, type ChainFacts } from "./decide.js";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function getText(fetchImpl: Fetcher, url: string, init?: RequestInit): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads the four chain calls. Timestamps stay digit strings from the raw body. */
export async function loadFacts(receiver: string, fetchImpl: Fetcher = fetch): Promise<ChainFacts> {
  const account = encodeURIComponent(receiver);
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "dontcare",
    method: "query",
    params: { request_type: "view_account", finality: "final", account_id: receiver },
  });
  const [view, created, outgoing, deploy] = await Promise.all([
    getText(fetchImpl, NEAR_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rpcBody,
    }),
    getText(fetchImpl, `${NEARBLOCKS}/${account}`),
    getText(fetchImpl, `${NEARBLOCKS}/${account}/txns-only/count?from=${account}`),
    getText(fetchImpl, `${NEARBLOCKS}/${account}/contract/deployments`),
  ]);

  return {
    codeHash: view.ok ? parseCodeHash(view.text) : null,
    createdNs: created.ok ? parseCreatedNs(created.text) : null,
    outgoingCount: outgoing.ok ? parseOutgoingCount(outgoing.text) : null,
    latestDeployNs: deploy.ok ? parseLatestDeployNs(deploy.text) : null,
    errors: {
      ...(view.ok ? {} : { codeHash: view.error }),
      ...(created.ok ? {} : { created: created.error }),
      ...(outgoing.ok ? {} : { outgoing: outgoing.error }),
      ...(deploy.ok ? {} : { deploy: deploy.error }),
    },
  };
}
