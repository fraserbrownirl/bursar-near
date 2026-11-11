import { isNearAccount } from "./account.js";
import { requestStops, runAgent, statedPayment } from "./agent.js";
import { loadBlocklist } from "./blocklist.js";
import { decide, formatCheck } from "./decide.js";
import { historyCsv } from "./history.js";
import { loadFacts } from "./load.js";

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: { name?: string; arguments?: Record<string, string> } };

const TOOLS = [
  { name: "pay", description: "Pay from the Intents balance. The same checks, guards, and guarded signer as bursar agent. A STOP is a tool error.", inputSchema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
  { name: "check", description: "Counterparty check for one account.", inputSchema: { type: "object", properties: { account: { type: "string" } }, required: ["account"] } },
  { name: "balance", description: "Intents USDC balance, and the Base float when one exists.", inputSchema: { type: "object", properties: {} } },
  { name: "history", description: "Payment ledger as CSV.", inputSchema: { type: "object", properties: {} } },
];

function textResult(text: string, isError = false): { content: { type: "text"; text: string }[]; isError: boolean } {
  return { content: [{ type: "text", text }], isError };
}

function stopped(text: string): boolean {
  return /(?:^|\n)(?:guard: )?STOP\b|Stopped:/.test(text);
}

async function callTool(name: string, args: Record<string, string>, accountId: string): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  if (name === "pay") {
    const request = args.request ?? "";
    const stated = statedPayment(request);
    const injected = requestStops(request, stated?.to ?? "");
    if (injected) return textResult(`STOP\nreason: ${injected}`, true);
    if (!accountId) return textResult("STOP: request", true);
    const report = await runAgent(request, accountId);
    return textResult(report.text, stopped(report.text));
  }
  if (name === "check") {
    const account = args.account ?? "";
    if (!account) return textResult("STOP: account", true);
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    const facts = isNearAccount(account) ? await loadFacts(account) : { codeHash: null, createdNs: null, outgoingCount: null, latestDeployNs: null, errors: {} };
    const result = decide({ receiver: account, nowNs, request: "", facts, payees: {}, blocklist: await loadBlocklist(account) });
    const text = formatCheck(result);
    return textResult(text, result.verdict === "block" || stopped(text));
  }
  if (name === "balance") {
    if (!accountId) return textResult("STOP: request", true);
    const { balanceReport } = await import("./base-float.js");
    return textResult(await balanceReport(accountId));
  }
  if (name === "history") return textResult(historyCsv());
  return textResult(`STOP: unknown tool ${name}`, true);
}

/** One MCP JSON-RPC message. A notification gets no response. */
export async function handleMcp(message: Rpc, accountId = process.env.BURSAR_NEAR_ACCOUNT ?? ""): Promise<Record<string, unknown> | null> {
  if (message.id === undefined || message.id === null) return null;
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "bursar", version: "0.1.0" } },
    };
  }
  if (message.method === "tools/list") return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name ?? "", message.params?.arguments ?? {}, accountId);
      return { jsonrpc: "2.0", id: message.id, result };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { jsonrpc: "2.0", id: message.id, result: textResult(text.startsWith("STOP") ? text : `STOP: ${text}`, true) };
    }
  }
  return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method" } };
}

function frame(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

/** stdio MCP. Reads Content-Length frames and writes frames. */
export function serveMcp(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    const finish = () => resolve();
    process.stdin.on("end", finish);
    process.stdin.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match?.[1]) return;
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString("utf8");
        buffer = buffer.subarray(start + length);
        void handleMcp(JSON.parse(body) as Rpc).then((response) => {
          if (!response) return;
          process.stdout.write(frame(JSON.stringify(response)));
        });
      }
    });
  });
}
