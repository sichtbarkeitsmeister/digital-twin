/**
 * Time budget of the DT chat model loop (`callDtAnthropicChat`), against a local fake
 * of the Anthropic streaming API. No network, no keys.
 * Run: npx tsx scripts/test-dt-chat-time-budget.ts
 */
import "./support/stub-server-only";

import assert from "node:assert/strict";

import {
  callDtAnthropicChat,
  DT_TIME_BUDGET_STOP_REASON,
  DtChatTimeBudgetError,
  dtChatFailureUserMessage,
} from "../lib/dt/anthropic-chat";
import {
  createFileReply,
  type FakeAnthropicApi,
  startFakeAnthropicApi,
  textReply,
} from "./support/fake-anthropic-api";

const userTurn = [{ role: "user" as const, content: "Optimiere die Unterseite." }];

async function testNormalTurnUnchanged(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle(() => textReply("Fertige Antwort."));
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "default" });
  assert.equal(out.text, "Fertige Antwort.");
  assert.equal(out.stopReason, "end_turn");
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0]?.tool_choice, undefined);
  console.log("normal turn unchanged: ok");
}

async function testCutRoundKeepsText(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle(() => {
    const reply = textReply("Erster Teil der Antwort.");
    // Header, text block and one delta, then silence: the model is still writing.
    return { events: reply.events.slice(0, 3), stall: true };
  });
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

async function testNothingWrittenThrowsClearError(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle(() => ({ events: [], stall: true }));
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

async function testWrapUpRoundWhenTimeRunsLow(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle((body, index) => (index === 0 ? createFileReply("tu_1") : textReply("Kurze Antwort aus dem Stand.")));
  const out = await callDtAnthropicChat({
    system: "Test",
    messages: userTurn,
    mode: "default",
    // Every round after the first is already inside the wrap-up window.
    timeBudget: { deadlineAt: Date.now() + 5_000, minRoundMs: 100, wrapUpMs: 10_000 },
  });
  assert.equal(api.seen.length, 2);
  const wrap = api.seen[1]!;
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

async function testRoundLimitEndsWithoutTools(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle((body, index) =>
    body.tool_choice?.type === "none" ? textReply("Zusammenfassung.") : createFileReply(`tu_${index}`),
  );
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "default" });
  assert.equal(api.seen.length, 7, "six tool rounds and one final round");
  const final = api.seen[6]!;
  assert.deepEqual(final.tool_choice, { type: "none" });
  assert.ok((final.tools ?? []).length > 0, "tools stay declared next to tool calls in history");
  assert.equal(out.text, "Zusammenfassung.");
  assert.equal(out.stopReason, "end_turn");
  console.log("round limit ends without tools: ok");
}

async function main() {
  const api = await startFakeAnthropicApi();
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = api.url;
  delete process.env.ANTHROPIC_DT_PERSONA_MODEL;
  try {
    await testNormalTurnUnchanged(api);
    await testCutRoundKeepsText(api);
    await testNothingWrittenThrowsClearError(api);
    await testWrapUpRoundWhenTimeRunsLow(api);
    await testRoundLimitEndsWithoutTools(api);
    console.log("all dt chat time budget tests passed");
  } finally {
    await api.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
