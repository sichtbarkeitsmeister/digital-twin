/**
 * SEO chat on Claude Sonnet 5.5: what the request sends, and how a decline by the safety
 * filters (`stop_reason: "refusal"`) is handled. Against a local fake of the Anthropic API.
 * Run: npx tsx scripts/test-dt-chat-models.ts
 */
import "./support/stub-server-only";

import assert from "node:assert/strict";

import {
  callDtAnthropicChat,
  DtChatRefusalError,
  dtChatFailureUserMessage,
} from "../lib/dt/anthropic-chat";
import {
  createFileReply,
  type FakeAnthropicApi,
  refusalReply,
  startFakeAnthropicApi,
  textReply,
} from "./support/fake-anthropic-api";

const userTurn = [{ role: "user" as const, content: "Optimiere die Unterseite Kanzleimarketing." }];

async function testSeoDefaultIsSonnet55WithoutThinking(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle(() => textReply("Antwort."));
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "seo" });
  const request = api.seen[0]!;
  assert.equal(request.model, "claude-sonnet-5-5");
  assert.deepEqual(request.thinking, { type: "between_tools" }, "no extended thinking eating max_tokens");
  assert.equal(request.max_tokens, 11_059, "8,192 × 1.35 for the larger token counts");
  assert.equal(out.model, "claude-sonnet-5-5");
  console.log("seo default is sonnet 5.5 without thinking: ok");
}

async function testDeclinedRoundRetriesOnSonnet46(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle((body) => (body.model === "claude-sonnet-5-5" ? refusalReply() : textReply("Antwort von Sonnet 4.6.")));
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "seo" });
  assert.deepEqual(
    api.seen.map((r) => r.model),
    ["claude-sonnet-5-5", "claude-sonnet-4-6"],
  );
  const retry = api.seen[1]!;
  assert.equal(retry.thinking, undefined, "between_tools goes to Sonnet 5.5 only");
  assert.equal(retry.max_tokens, 8_192);
  assert.equal(out.text, "Antwort von Sonnet 4.6.");
  assert.equal(out.model, "claude-sonnet-4-6");
  assert.equal(out.usage.inputTokens, 200, "the declined attempt is billed and counted too");
  console.log("declined round retries on sonnet 4.6: ok");
}

async function testDeclinedEverywhereGivesClearError(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle(() => refusalReply("general_harms"));
  await assert.rejects(
    callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "seo" }),
    (err: unknown) => {
      assert.ok(err instanceof DtChatRefusalError, String(err));
      assert.equal(
        dtChatFailureUserMessage(err),
        "Die KI hat diese Anfrage abgelehnt: Ein Sicherheitsfilter von Anthropic hat angeschlagen (Kategorie „general_harms“). Bitte die Anfrage anders formulieren.",
      );
      return true;
    },
  );
  assert.equal(api.seen.length, 2, "one retry, no loop");
  console.log("declined everywhere gives a clear error: ok");
}

async function testDeclineAfterWorkKeepsIt(api: FakeAnthropicApi) {
  api.seen.length = 0;
  api.handle((body, index) => (index === 0 ? createFileReply("tu_1") : refusalReply()));
  const out = await callDtAnthropicChat({ system: "Test", messages: userTurn, mode: "seo" });
  assert.equal(out.createdFiles.length, 1, "the file from the first round is kept");
  assert.match(out.text, /Sicherheitsfilter von Anthropic/);
  assert.equal(out.stopReason, "refusal");
  console.log("decline after work keeps it: ok");
}

async function main() {
  const api = await startFakeAnthropicApi();
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = api.url;
  delete process.env.ANTHROPIC_DT_SEO_MODEL;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await testSeoDefaultIsSonnet55WithoutThinking(api);
    await testDeclinedRoundRetriesOnSonnet46(api);
    await testDeclinedEverywhereGivesClearError(api);
    await testDeclineAfterWorkKeepsIt(api);
    console.log("all dt chat model tests passed");
  } finally {
    console.warn = warn;
    await api.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
