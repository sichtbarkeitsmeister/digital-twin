/**
 * Tests for DT chat Anthropic request shaping (history trim + message normalize).
 * Run: npx tsx scripts/test-dt-anthropic-chat.ts
 */
import assert from "node:assert/strict";

import {
  extractAnthropicText,
  isAnthropicBetaHeaderError,
  readAnthropicMessageStream,
} from "../lib/ai/anthropic-helpers";
import {
  dtAnthropicBetaHeaders,
  dtAnthropicModelsForMode,
  dtChatFailureUserMessage,
  normalizeDtAnthropicMessages,
} from "../lib/dt/anthropic-chat";
import { trimDtChatHistory } from "../lib/dt/assemble-chat-prompt";

function testMergeConsecutiveUserTurns() {
  const out = normalizeDtAnthropicMessages([
    { role: "user", content: "Ja, Aufgabe anlegen." },
    { role: "user", content: "Und Content-Lücken weiterplanen." },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.role, "user");
  assert.equal(
    out[0]?.content,
    "Ja, Aufgabe anlegen.\n\nUnd Content-Lücken weiterplanen.",
  );
  console.log("merge consecutive user turns: ok");
}

function testDropEmptyAndLeadingAssistant() {
  const out = normalizeDtAnthropicMessages([
    { role: "assistant", content: "orphan" },
    { role: "user", content: "   " },
    { role: "user", content: "Bitte Sitemap prüfen." },
    { role: "assistant", content: "Hier die Analyse." },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.role, "user");
  assert.equal(out[0]?.content, "Bitte Sitemap prüfen.");
  console.log("drop empty and leading/trailing assistant: ok");
}

function testKeepValidAlternatingHistory() {
  const out = normalizeDtAnthropicMessages([
    { role: "user", content: "Hallo" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Weiter" },
  ]);
  assert.deepEqual(
    out.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  console.log("keep valid alternating history: ok");
}

function testTrimHistoryKeepsLatestUnderBudget() {
  const rows = [
    { id: "1", content: "a".repeat(80) },
    { id: "2", content: "b".repeat(80) },
    { id: "3", content: "latest" },
  ];
  const kept = trimDtChatHistory(rows, { limit: 40, charBudget: 90 });
  assert.equal(kept.at(-1)?.id, "3");
  assert.ok(kept.length < rows.length);
  assert.ok(kept.every((r) => r.id !== "1"));
  console.log("trim history keeps latest under budget: ok");
}

function testTrimHistoryAlwaysKeepsLastMessage() {
  const rows = [{ id: "huge", content: "x".repeat(200) }];
  const kept = trimDtChatHistory(rows, { limit: 10, charBudget: 10 });
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, "huge");
  console.log("trim history always keeps last message: ok");
}

function testKeepDocumentBlocks() {
  const out = normalizeDtAnthropicMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "kannst du das lesen?" },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
        },
      ],
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(Array.isArray(out[0]?.content), true);
  const types = Array.isArray(out[0]?.content) ? out[0].content.map((b) => b.type) : [];
  assert.deepEqual(types, ["text", "document"]);
  console.log("keep pdf document blocks: ok");
}

function testFailureMessages() {
  assert.equal(
    dtChatFailureUserMessage(new Error("Request timed out")),
    "Die KI hat zu lange gebraucht. Bitte erneut versuchen.",
  );
  assert.equal(
    dtChatFailureUserMessage({
      error: { message: "prompt is too long: 220000 tokens" },
    }),
    "Der Chat ist zu lang für eine KI-Antwort. Bitte einen neuen Chat starten.",
  );
  assert.equal(
    dtChatFailureUserMessage({ status: 529, error: { type: "overloaded_error" } }),
    "Die KI ist gerade überlastet. Bitte in einem Moment erneut versuchen.",
  );
  assert.equal(
    dtChatFailureUserMessage(new Error("unknown")),
    "KI-Antwort fehlgeschlagen. Bitte erneut versuchen.",
  );
  assert.equal(
    dtChatFailureUserMessage({
      status: 400,
      error: { type: "invalid_request_error", message: "Your credit balance is too low." },
    }),
    "Das Anthropic-Guthaben ist aufgebraucht. Unter Plans & Billing Credits kaufen — danach antworten Chat und Agent-Generierung wieder.",
  );
  assert.equal(
    dtChatFailureUserMessage(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_test"}',
      ),
    ),
    "Das Anthropic-Guthaben ist aufgebraucht. Unter Plans & Billing Credits kaufen — danach antworten Chat und Agent-Generierung wieder.",
  );
  assert.equal(
    dtChatFailureUserMessage(new Error("401 invalid x-api-key")),
    "Die KI-Anmeldung wurde abgelehnt. Bitte den API-Schlüssel prüfen.",
  );
  assert.equal(
    dtChatFailureUserMessage(new Error("ANTHROPIC_API_KEY fehlt.")),
    "ANTHROPIC_API_KEY fehlt.",
  );
  console.log("failure messages: ok");
}

function testBetaHeadersOnlyForPdf() {
  assert.equal(dtAnthropicBetaHeaders([{ role: "user", content: "hallo" }]), undefined);
  const headers = dtAnthropicBetaHeaders([
    {
      role: "user",
      content: [
        { type: "text", text: "lies das" },
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
        },
      ],
    },
  ]);
  assert.equal(headers?.["anthropic-beta"], "pdfs-2024-09-25");
  assert.equal(headers?.["anthropic-beta"]?.includes("prompt-caching"), false);
  const seoModels = dtAnthropicModelsForMode("seo");
  assert.equal(
    seoModels[0],
    process.env.ANTHROPIC_DT_SEO_MODEL?.trim() || "claude-sonnet-4-6",
  );
  assert.equal(seoModels.includes("claude-sonnet-4-6"), true);
  assert.equal(seoModels.includes("claude-sonnet-5"), true);
  console.log("beta headers and model fallbacks: ok");
}

function testBetaHeaderErrorDetect() {
  assert.equal(
    isAnthropicBetaHeaderError(
      new Error(
        "400 Unexpected value(s) `pdfs-2024-09-25` for the `anthropic-beta` header.",
      ),
    ),
    true,
  );
  assert.equal(isAnthropicBetaHeaderError(new Error("prompt is too long")), false);
  console.log("beta header error detect: ok");
}

async function testStreamWithoutUsageStillReturnsText() {
  async function* events() {
    yield {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message" as const,
        role: "assistant" as const,
        content: [],
        model: "claude-sonnet-4-6",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 1 },
      },
    };
    yield {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" as const, text: "" },
    };
    yield {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hallo" },
    };
    yield { type: "content_block_stop", index: 0 };
    yield {
      type: "message_delta",
      delta: { stop_reason: "end_turn" as const, stop_sequence: null },
    };
    yield { type: "message_stop" };
  }

  const message = await readAnthropicMessageStream(events());
  assert.equal(extractAnthropicText(message), "Hallo");
  assert.equal(message.stop_reason, "end_turn");
  assert.equal(message.usage.input_tokens, 4);
  console.log("stream without usage still returns text: ok");
}

async function testStreamToolInput() {
  async function* events() {
    yield {
      type: "message_start",
      message: {
        id: "msg_tool",
        type: "message" as const,
        role: "assistant" as const,
        content: [],
        model: "claude-sonnet-4-6",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 8, output_tokens: 1 },
      },
    };
    yield {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use" as const,
        id: "toolu_1",
        name: "search_website_content",
        input: {},
      },
    };
    yield {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"query":' },
    };
    yield {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '"impressum"}' },
    };
    yield { type: "content_block_stop", index: 0 };
    yield {
      type: "message_delta",
      delta: { stop_reason: "tool_use" as const, stop_sequence: null },
      usage: { output_tokens: 20 },
    };
    yield { type: "message_stop" };
  }

  const message = await readAnthropicMessageStream(events());
  const tool = message.content.find((block) => block.type === "tool_use");
  assert.equal(tool && tool.type === "tool_use" ? tool.name : "", "search_website_content");
  assert.deepEqual(tool && tool.type === "tool_use" ? tool.input : null, { query: "impressum" });
  assert.equal(message.usage.output_tokens, 20);
  console.log("stream tool input: ok");
}

async function main() {
  testMergeConsecutiveUserTurns();
  testDropEmptyAndLeadingAssistant();
  testKeepValidAlternatingHistory();
  testTrimHistoryKeepsLatestUnderBudget();
  testTrimHistoryAlwaysKeepsLastMessage();
  testKeepDocumentBlocks();
  testFailureMessages();
  testBetaHeadersOnlyForPdf();
  testBetaHeaderErrorDetect();
  await testStreamWithoutUsageStillReturnsText();
  await testStreamToolInput();
  console.log("all dt anthropic-chat tests passed");
}

void main();
