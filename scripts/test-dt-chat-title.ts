import assert from "node:assert/strict";

import {
  DEFAULT_DT_CHAT_TITLE,
  fallbackDtChatTitle,
  isMeaningfulAssistantReply,
  sanitizeDtChatTitle,
  shouldAutoTitleDtChat,
} from "../lib/dt/chat-title";

function testDefaultTitleGate() {
  assert.equal(
    shouldAutoTitleDtChat({
      currentTitle: "SEO Strategie Q3",
      userMessageCount: 5,
      assistantText: "x".repeat(200),
    }),
    false,
  );
  assert.equal(
    shouldAutoTitleDtChat({
      currentTitle: "  ",
      userMessageCount: 2,
      assistantText: "kurz",
    }),
    true,
  );
  console.log("default title gate: ok");
}

function testTitlesAtLatestAfterSecondUserMessage() {
  // First short exchange: keep "Neuer Chat" until more context exists.
  assert.equal(
    shouldAutoTitleDtChat({
      currentTitle: DEFAULT_DT_CHAT_TITLE,
      userMessageCount: 1,
      assistantText: "Ok.",
    }),
    false,
  );

  // Second user question: always title.
  assert.equal(
    shouldAutoTitleDtChat({
      currentTitle: DEFAULT_DT_CHAT_TITLE,
      userMessageCount: 2,
      assistantText: "Ok.",
    }),
    true,
  );
  console.log("title at latest after 2nd user message: ok");
}

function testEarlyTitleWhenFirstReplyMeaningful() {
  const meaningful =
    "Gerne helfe ich dir bei der Keyword-Recherche für eure neue Landingpage und schlage konkrete nächste Schritte vor.";
  assert.equal(isMeaningfulAssistantReply(meaningful), true);
  assert.equal(
    shouldAutoTitleDtChat({
      currentTitle: DEFAULT_DT_CHAT_TITLE,
      userMessageCount: 1,
      assistantText: meaningful,
    }),
    true,
  );
  console.log("early title on meaningful first reply: ok");
}

function testSanitizeAndFallback() {
  assert.equal(sanitizeDtChatTitle('  "Keyword-Recherche Start"  '), "Keyword-Recherche Start");
  assert.equal(sanitizeDtChatTitle(DEFAULT_DT_CHAT_TITLE), null);
  assert.equal(fallbackDtChatTitle("  Hallo   Welt  ".repeat(10)).length, 60);
  assert.equal(fallbackDtChatTitle("   "), DEFAULT_DT_CHAT_TITLE);
  console.log("sanitize and fallback: ok");
}

testDefaultTitleGate();
testTitlesAtLatestAfterSecondUserMessage();
testEarlyTitleWhenFirstReplyMeaningful();
testSanitizeAndFallback();
console.log("all dt chat-title tests passed");
