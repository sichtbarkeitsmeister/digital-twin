/**
 * Texte on Claude Sonnet 5.5: the request carries `thinking: between_tools` (the model thinks
 * by default and the thinking counts toward max_tokens) and an output budget 1.35× the one sized
 * for Sonnet 4.6 (the newer tokenizer). Both only for Sonnet 5.5: a fallback to Sonnet 4.6 gets
 * the request as before, since every other model rejects `between_tools`. The cost column prices
 * Sonnet 5.x and Opus 5.5 at their own rates. Stub client; no network, no model.
 * Run: npm run test:content-model-params
 */
import assert from "node:assert/strict";

import type Anthropic from "@anthropic-ai/sdk";

import { callContentResearch, callContentTool, contentModelParams } from "../lib/dt/content/pipeline/llm";
import { estimateCostEur, priceForModel } from "../lib/dt/content/pricing";

type Body = { model: string; max_tokens: number; thinking?: { type: string }; tool_choice?: { type: string } };
type StubMessage = { content: unknown[]; stop_reason: string; usage: Record<string, unknown> };

/** Answers in order; records every request body. */
function stubClient(answers: Array<StubMessage | Error>, seen: Body[]): Anthropic {
  let i = 0;
  const create = async (body: Body) => {
    seen.push(body);
    const answer = answers[i++];
    if (!answer) throw new Error("no more answers");
    if (answer instanceof Error) throw answer;
    const message: StubMessage = answer;
    async function* events() {
      yield { type: "message_start", message: { id: `m${i}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
      for (const [index, block] of message.content.entries()) yield { type: "content_block_start", index, content_block: block };
      yield { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage };
    }
    return events();
  };
  return { messages: { create } } as unknown as Anthropic;
}

function apiError(status: number, type: string, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { type, message } });
}

const TOOL: Anthropic.Tool = { name: "ergebnis", description: "Ergebnis", input_schema: { type: "object", properties: { text: { type: "string" } } } };
const toolAnswer = (): StubMessage => ({
  content: [{ type: "tool_use", id: "t1", name: "ergebnis", input: { text: "Lastenradträger" } }],
  stop_reason: "tool_use",
  usage: { input_tokens: 1_000, output_tokens: 200 },
});
const forcedRefused = () => apiError(400, "invalid_request_error", "tool_choice.type 'tool' is not supported for this model");
const notFound = () => apiError(404, "not_found_error", "model: claude-sonnet-5-5");

// --- what each model gets -------------------------------------------------------------------------
{
  assert.deepEqual(contentModelParams("claude-sonnet-4-6", 12_000), { maxTokens: 12_000 }, "Sonnet 4.6: unchanged, no thinking field");
  assert.deepEqual(contentModelParams("claude-opus-5-5", 12_000), { maxTokens: 12_000 }, "other 5.x models: unchanged (not covered here)");
  const sonnet55 = contentModelParams("claude-sonnet-5-5", 12_000);
  assert.equal(sonnet55.maxTokens, 16_200, "the Lektorat's 12,000 become 16,200");
  assert.deepEqual(sonnet55.thinking, { type: "between_tools" });
  assert.equal(contentModelParams("claude-sonnet-5-5", 8_000).maxTokens, 10_800);
  console.log("model params: ok");
}

async function toolCalls() {
  // Sonnet 5.5 refuses the forced tool_choice; the retry with `auto` keeps its settings.
  const seen: Body[] = [];
  const result = await callContentTool({
    models: ["claude-sonnet-5-5", "claude-sonnet-4-6"],
    system: "s",
    user: "u",
    tool: TOOL,
    maxTokens: 12_000,
    anthropic: stubClient([forcedRefused(), toolAnswer()], seen),
  });
  assert.equal(result.model, "claude-sonnet-5-5");
  assert.deepEqual(result.json, { text: "Lastenradträger" });
  assert.equal(seen.length, 2);
  for (const body of seen) {
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.max_tokens, 16_200);
    assert.deepEqual(body.thinking, { type: "between_tools" });
  }
  assert.deepEqual(seen.map((b) => b.tool_choice?.type), ["tool", "auto"]);

  // Sonnet 5.5 not available (404): the fallback Sonnet 4.6 gets the request of before.
  const fallback: Body[] = [];
  const viaFallback = await callContentTool({
    models: ["claude-sonnet-5-5", "claude-sonnet-4-6"],
    system: "s",
    user: "u",
    tool: TOOL,
    maxTokens: 12_000,
    anthropic: stubClient([notFound(), toolAnswer()], fallback),
  });
  assert.equal(viaFallback.model, "claude-sonnet-4-6");
  assert.equal(fallback[1]!.model, "claude-sonnet-4-6");
  assert.equal(fallback[1]!.max_tokens, 12_000);
  assert.equal("thinking" in fallback[1]!, false, "Sonnet 4.6 would reject between_tools");
  assert.equal(fallback[1]!.tool_choice?.type, "tool", "and keeps the forced tool");

  // Sonnet 4.6 alone: exactly the request of before.
  const plain: Body[] = [];
  await callContentTool({ models: ["claude-sonnet-4-6"], system: "s", user: "u", tool: TOOL, maxTokens: 6_000, anthropic: stubClient([toolAnswer()], plain) });
  assert.equal(plain.length, 1);
  assert.equal(plain[0]!.max_tokens, 6_000);
  assert.equal("thinking" in plain[0]!, false);
  console.log("tool calls: ok");
}

async function researchCalls() {
  // The web research of the Aktualitätsprüfung: same settings, on every paused round.
  const seen: Body[] = [];
  const paused: StubMessage = {
    content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Lastenradträger Anhängerkupplung" } }],
    stop_reason: "pause_turn",
    usage: { input_tokens: 1_000, output_tokens: 50, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
  };
  const done: StubMessage = { content: [{ type: "text", text: "Keine zeitkritischen Aussagen." }], stop_reason: "end_turn", usage: { input_tokens: 1_200, output_tokens: 80 } };
  await callContentResearch({ models: ["claude-sonnet-5-5"], system: "s", user: "u", maxTokens: 4_000, timeoutMs: 30_000, anthropic: stubClient([paused, done], seen) });
  assert.equal(seen.length, 2);
  for (const body of seen) {
    assert.equal(body.max_tokens, 5_400);
    assert.deepEqual(body.thinking, { type: "between_tools" });
  }
  console.log("research calls: ok");
}

// --- prices ---------------------------------------------------------------------------------------
{
  const usd = (model: string) => [priceForModel(model).inputUsd, priceForModel(model).outputUsd];
  assert.deepEqual(usd("claude-sonnet-5-5"), [2, 10]);
  assert.deepEqual(usd("claude-sonnet-5"), [2, 10]);
  assert.deepEqual(usd("claude-opus-5-5"), [4, 20]);
  assert.deepEqual(usd("claude-opus-5"), [5, 25]);
  assert.deepEqual(usd("claude-sonnet-4-6"), [3, 15], "Sonnet 4.6 unchanged");
  assert.deepEqual(usd("claude-sonnet-4-20250514"), [3, 15]);
  assert.deepEqual(usd("claude-3-5-sonnet-latest"), [3, 15]);
  // The Lektorat of the A/B run (29.10.): 39,647 in, 11,459 out on Sonnet 5.5.
  assert.equal(estimateCostEur("claude-sonnet-5-5", { inputTokens: 39_647, outputTokens: 11_459 }, 1), 0.1939);
  console.log("prices: ok");
}

toolCalls()
  .then(researchCalls)
  .then(() => console.log("OK: content model params tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
