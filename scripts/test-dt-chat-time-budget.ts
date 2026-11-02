/**
 * Time budget of the DT chat model loop (`callDtAnthropicChat`), against a local fake
 * of the Anthropic streaming API. No network, no keys.
 * Run: npx tsx scripts/test-dt-chat-time-budget.ts
 */
import "./support/stub-server-only";

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  callDtAnthropicChat,
  DT_TIME_BUDGET_STOP_REASON,
  DtChatTimeBudgetError,
  dtChatFailureUserMessage,
} from "../lib/dt/anthropic-chat";

type RequestBody = {
  max_tokens: number;
  tools?: Array<{ name: string }>;
  tool_choice?: { type: string };
  messages: Array<{ role: string; content: unknown }>;
};

/** One fake API response; `stall` keeps the stream open until the client gives up. */
type Reply = { events: Array<Record<string, unknown>>; stall?: boolean };
type Handler = (body: RequestBody, index: number) => Reply;

const seen: RequestBody[] = [];
let handler: Handler = () => ({ events: [] });

function messageStart(): Record<string, unknown> {
  return {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  };
}

function textReply(text: string, stopReason = "end_turn"): Reply {
  return {
    events: [
      messageStart(),
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ],
  };
}

function createFileReply(id: string): Reply {
  const input = JSON.stringify({ filename: `notiz-${id}.md`, format: "markdown", content: "# Notiz\n\nInhalt." });
  return {
    events: [
      messageStart(),
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "create_file", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: input } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } },
      { type: "message_stop" },
    ],
  };
}

async function startFakeApi(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as RequestBody;
      seen.push(body);
      const reply = handler(body, seen.length - 1);
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of reply.events) {
        res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      if (!reply.stall) res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const userTurn = [{ role: "user" as const, content: "Optimiere die Unterseite." }];

async function testNormalTurnUnchanged() {
  seen.length = 0;
  handler = () => textReply("Fertige Antwort.");
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "default" });
  assert.equal(out.text, "Fertige Antwort.");
  assert.equal(out.stopReason, "end_turn");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.tool_choice, undefined);
  console.log("normal turn unchanged: ok");
}

async function testCutRoundKeepsText() {
  seen.length = 0;
  handler = () => {
    const reply = textReply("Erster Teil der Antwort.");
    // Header, text block and one delta, then silence: the model is still writing.
    return { events: reply.events.slice(0, 3), stall: true };
  };
  const started = Date.now();
  const out = await callDtAnthropicChat({
    system: "Test",
    messages: userTurn,
    mode: "default",
    timeBudget: { deadlineAt: Date.now() + 1_500, minRoundMs: 100, wrapUpMs: 500 },
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `stopped near the deadline, took ${elapsed} ms`);
  assert.ok(out.text.startsWith("Erster Teil der Antwort."), out.text);
  assert.match(out.text, /Aus Zeitgründen wurde diese Antwort nach .* beendet/);
  assert.equal(out.stopReason, DT_TIME_BUDGET_STOP_REASON);
  assert.equal(out.usage.inputTokens, 100, "input tokens of the cut round still count");
  console.log("cut round keeps its text: ok");
}

async function testNothingWrittenThrowsClearError() {
  seen.length = 0;
  handler = () => ({ events: [], stall: true });
  await assert.rejects(
    callDtAnthropicChat({
      system: "Test",
      messages: userTurn,
      mode: "default",
      timeBudget: { deadlineAt: Date.now() + 1_000, minRoundMs: 100, wrapUpMs: 500 },
    }),
    (err: unknown) => {
      assert.ok(err instanceof DtChatTimeBudgetError, String(err));
      const message = dtChatFailureUserMessage(err);
      assert.match(message, /keine Antwort fertig bekommen/);
      assert.match(message, /kleinere Schritte/);
      return true;
    },
  );
  console.log("nothing written gives a clear error: ok");
}

async function testWrapUpRoundWhenTimeRunsLow() {
  seen.length = 0;
  handler = (body, index) => (index === 0 ? createFileReply("tu_1") : textReply("Kurze Antwort aus dem Stand."));
  const out = await callDtAnthropicChat({
    system: "Test",
    messages: userTurn,
    mode: "default",
    // Every round after the first is already inside the wrap-up window.
    timeBudget: { deadlineAt: Date.now() + 5_000, minRoundMs: 100, wrapUpMs: 10_000 },
  });
  assert.equal(seen.length, 2);
  const wrap = seen[1]!;
  assert.deepEqual(wrap.tool_choice, { type: "none" }, "last round may not call tools");
  assert.ok((wrap.tools ?? []).some((t) => t.name === "create_file"), "tools stay declared");
  assert.equal(wrap.max_tokens, 1_024, "output sized to the time left");
  const last = wrap.messages[wrap.messages.length - 1]!;
  assert.equal(last.role, "user");
  const blocks = last.content as Array<{ type: string; text?: string }>;
  assert.equal(blocks[0]?.type, "tool_result", "tool results stay first");
  assert.match(blocks[blocks.length - 1]?.text ?? "", /Die Zeit für diese Antwort ist fast aufgebraucht/);
  assert.match(out.text, /^Kurze Antwort aus dem Stand\./);
  assert.match(out.text, /Recherche nach .* beendet/);
  assert.equal(out.stopReason, DT_TIME_BUDGET_STOP_REASON);
  assert.equal(out.createdFiles.length, 1, "the file from the first round is kept");
  console.log("wrap-up round when time runs low: ok");
}

async function testRoundLimitEndsWithoutTools() {
  seen.length = 0;
  handler = (body, index) =>
    body.tool_choice?.type === "none" ? textReply("Zusammenfassung.") : createFileReply(`tu_${index}`);
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "default" });
  assert.equal(seen.length, 7, "six tool rounds and one final round");
  const final = seen[6]!;
  assert.deepEqual(final.tool_choice, { type: "none" });
  assert.ok((final.tools ?? []).length > 0, "tools stay declared next to tool calls in history");
  assert.equal(out.text, "Zusammenfassung.");
  assert.equal(out.stopReason, "end_turn");
  console.log("round limit ends without tools: ok");
}

async function main() {
  const api = await startFakeApi();
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = api.url;
  delete process.env.ANTHROPIC_DT_PERSONA_MODEL;
  try {
    await testNormalTurnUnchanged();
    await testCutRoundKeepsText();
    await testNothingWrittenThrowsClearError();
    await testWrapUpRoundWhenTimeRunsLow();
    await testRoundLimitEndsWithoutTools();
    console.log("all dt chat time budget tests passed");
  } finally {
    await api.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
