/**
 * Tests for DT chat Anthropic request shaping (history trim + message normalize).
 * Run: npx tsx scripts/test-dt-anthropic-chat.ts
 */
import assert from "node:assert/strict";

import {
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
  console.log("failure messages: ok");
}

testMergeConsecutiveUserTurns();
testDropEmptyAndLeadingAssistant();
testKeepValidAlternatingHistory();
testTrimHistoryKeepsLatestUnderBudget();
testTrimHistoryAlwaysKeepsLastMessage();
testFailureMessages();
console.log("all dt anthropic-chat tests passed");
