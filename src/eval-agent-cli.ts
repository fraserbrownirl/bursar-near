import { intentFromArgs, SYSTEM, TOOLS } from "./agent.js";
import { loadConversations, scoreUnderstand, userText, type Conversation, type Understand } from "./eval-agent.js";

type RawCall = { function?: { name?: string; arguments?: unknown } };

function understandOf(message: { tool_calls?: RawCall[] }): Understand | null {
  const calls = message.tool_calls ?? [];
  let found: Understand | null = null;
  for (const call of calls) {
    if (call.function?.name !== "understand") continue;
    const raw = call.function.arguments;
    const args = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
    found = {
      to: typeof args?.to === "string" ? args.to : "",
      amount: typeof args?.amount === "string" || typeof args?.amount === "number" ? String(args.amount) : "",
      asset: typeof args?.asset === "string" ? args.asset : "",
    };
  }
  return found;
}

async function ask(url: string, messages: unknown[]): Promise<{ content: string; call: Understand | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "bursar", max_tokens: 512, messages, tools: TOOLS }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string; tool_calls?: RawCall[] } }[] };
  const message = body.choices?.[0]?.message ?? {};
  return { content: message.content ?? "", call: understandOf(message) };
}

function systemFor(conversation: Conversation): string {
  const payees = conversation.payees;
  if (!payees) return SYSTEM;
  const lines = Object.entries(payees).map(([name, account]) => `${name} is ${account}`);
  return `${SYSTEM}\nSaved names: ${lines.join(", ")}.`;
}

async function runOne(url: string, conversation: Conversation): Promise<{ pass: boolean; detail: string }> {
  const messages: unknown[] = [{ role: "system", content: systemFor(conversation) }];
  let call: Understand | null = null;
  for (const turn of conversation.turns) {
    messages.push({ role: "user", content: userText(turn) });
    const answer = await ask(url, messages);
    call = answer.call ?? call;
    messages.push({
      role: "assistant",
      content: answer.content,
      ...(answer.call ? { tool_calls: [{
        id: "understand",
        type: "function",
        function: { name: "understand", arguments: JSON.stringify(answer.call) },
      }] } : {}),
    });
    if (answer.call) {
      const heard = intentFromArgs(answer.call);
      messages.push({ role: "tool", tool_call_id: "understand", content: heard.ok ? "understood" : heard.ask });
    }
  }
  return scoreUnderstand(conversation, call);
}

export async function scoreModel(url: string, conversations: Conversation[]): Promise<{ pass: number; total: number; lines: string[] }> {
  const lines: string[] = [];
  let pass = 0;
  for (const conversation of conversations) {
    const result = await runOne(url, conversation);
    if (result.pass) pass += 1;
    const line = `${result.pass ? "pass" : "fail"} ${conversation.id} ${result.detail}`;
    process.stdout.write(line + "\n");
    lines.push(line);
  }
  return { pass, total: conversations.length, lines };
}

async function main(): Promise<void> {
  const conversations = loadConversations();
  const models: { name: string; url: string | undefined }[] = [
    { name: "9b", url: process.env.BURSAR_EVAL_9B ?? "http://127.0.0.1:8000/v1/chat/completions" },
    { name: "2b", url: process.env.BURSAR_EVAL_2B },
  ];
  const columns: string[] = [];
  let any = false;
  for (const model of models) {
    if (!model.url) {
      process.stdout.write(`${model.name} not run\n`);
      columns.push(`${model.name} not run`);
      continue;
    }
    try {
      const scored = await scoreModel(model.url, conversations);
      any = true;
      process.stdout.write(`${model.name} ${scored.pass}/${scored.total}\n`);
      columns.push(`${model.name} ${scored.pass}/${scored.total}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${model.name} not run\n${message}\n`);
      columns.push(`${model.name} not run`);
    }
  }
  process.stdout.write(columns.join(" | ") + "\n");
  if (!any) process.exit(2);
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});
