/**
 * Texte: prompt caching. Every step of a page sends the same beginning (all step tools, then the
 * Anbieterfakten with Kontaktdaten and Vorgaben, then the Avatar) so the second step reads it from
 * Anthropic's prompt cache; the page's own text and briefing follow in the user message. Cached
 * input is billed at its own rates. No network (a local fake of the Messages API), no model.
 * Run: npm run test:content-prompt-cache
 */
import assert from "node:assert/strict";

import Anthropic from "@anthropic-ai/sdk";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { CONTENT_PROMPT_CACHE_ENV, cachedRequestParts, callContentTool, contentPromptCacheEnabled, contentUsage } from "../lib/dt/content/pipeline/llm";
import { withoutPageFacts } from "../lib/dt/content/pipeline/page-facts-model";
import { contentStepSpec, contentStepTools, sharedContextBlocks, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { stepPromptCache, stepTokenUsage } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEPS, CONTENT_STEP_SEO } from "../lib/dt/content/pipeline/steps";
import { CACHE_WRITE_FACTOR, cacheReadFactor, estimateCostEur } from "../lib/dt/content/pricing";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

import { messageStart, startFakeAnthropicApi } from "./support/fake-anthropic-api";

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Lindner",
  page: {
    name: "Erschöpfung", path: "/erschoepfung", level: 1, url: null, source: "structure", page_role: "pillar", page_type: "hauptsilo",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Labordiagnostik und Infusionen. Erstgespräch 60 Minuten." }],
  settings: { anrede: "Sie", branche: "Heilpraktiker", tonalitaet: "sachlich", verbotene_woerter: ["Heilung"] },
  avatar: { name: "Sabine", role: "Wunschkundin", beschreibung: "Seit Monaten erschöpft, Blutwerte unauffällig." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: ["Antwort des Kunden auf „Gibt es Abendtermine?“: Ja, dienstags."],
  contact: null,
  customerAnswers: [{ question: "Gibt es Abendtermine?", answer: "Ja, dienstags." }],
  wishes: { organisation: ["keine Preise"], page: ["Fallbeispiel nennen"] },
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [{ id: "h1", heading: "Erschöpfung behandeln", level: 1, html: "<p>Text der Seite.</p>" }],
  title: null,
  metaDescription: null,
  ...patch,
});

const claudeSteps = CONTENT_STEPS.filter((d) => d.provider === "anthropic" && d.key !== "aktualitaet");

{
  // The shared beginning is the same for every step and every page of the organisation.
  const a = context();
  const b = context({
    page: { ...a.page, name: "Blutwerte", path: "/blutwerte", page_type: "unterseite", page_role: "supporting", pillar_name: "Erschöpfung" },
    blocks: [{ id: "x", heading: "Anderer Text", level: 1, html: "<p>Ganz anderer Text.</p>" }],
    notes: [],
    customerAnswers: [],
    wishes: { organisation: ["keine Preise"], page: [] },
  });
  assert.deepEqual(sharedContextBlocks(a), sharedContextBlocks(b), "page, text, notes and answers are no part of it");
  assert.equal(JSON.stringify(contentStepTools(a)), JSON.stringify(contentStepTools(b)), "the tool list does not depend on the page");
  assert.deepEqual(contentStepTools(a).map((t) => t.name), claudeSteps.map((d) => contentStepSpec(d.step, a).tool.name), "all step tools, in step order");
  const shared = sharedContextBlocks(a);
  assert.match(shared.org, /^## Anbieterfakten[\s\S]*Labordiagnostik[\s\S]*## Vorgaben[\s\S]*Verbotene Wörter/);
  assert.ok(!shared.org.includes("Abendtermine"), "the customer's answers change while a page runs: not in the shared part");
  assert.match(shared.audience, /^## Avatar[\s\S]*Seit Monaten erschöpft/);
  console.log("shared beginning: ok");
}

{
  // Each step: the whole message as before, and the rest without the shared blocks.
  const ctx = context();
  const shared = sharedContextBlocks(ctx);
  for (const def of claudeSteps) {
    const spec = contentStepSpec(def.step, ctx);
    assert.ok(spec.userRest != null, `${def.name} has a rest`);
    assert.ok(spec.user.includes("Labordiagnostik und Infusionen") && spec.user.includes("Seit Monaten erschöpft"), `${def.name}: the whole message still holds facts and avatar`);
    for (const gone of ["Labordiagnostik und Infusionen", "Seit Monaten erschöpft", "## Vorgaben"]) {
      assert.ok(!spec.userRest!.includes(gone), `${def.name}: „${gone}“ is in the shared beginning, not in the rest`);
    }
    assert.ok(spec.userRest!.includes("Seite: Erschöpfung"), `${def.name}: the page stays in the rest`);
    assert.match(spec.userRest!, /## Ergänzung der Anbieterfakten[\s\S]*Gibt es Abendtermine\? → Ja, dienstags\./, `${def.name}: answers of the customer stay with the page`);
    // Nothing is lost: every line of the whole message is in the shared blocks or in the rest.
    const cached = `${shared.org}\n${shared.audience}\n${spec.userRest}`;
    const lost = spec.user.split("\n").filter((line) => line.trim() && !cached.includes(line));
    assert.deepEqual(lost, [], `${def.name}: no line of the prompt is lost`);
  }
  assert.equal(contentStepSpec(CONTENT_STEP_SEO, context({ customerAnswers: [], pendingChecks: [], pageFacts: null })).userRest!.includes("Ergänzung der Anbieterfakten"), false, "no empty block");
  console.log("user message without the shared blocks: ok");
}

{
  const cache = stepPromptCache(context());
  const parts = cachedRequestParts(cache, "Schrittregeln", contentStepSpec(CONTENT_STEP_SEO, context()).tool);
  assert.equal(parts.tools.length, claudeSteps.length);
  assert.deepEqual(parts.system.map((b) => b.cache_control), [{ type: "ephemeral" }, { type: "ephemeral" }, { type: "ephemeral" }], "three breakpoints, four are allowed");
  assert.equal(parts.system[2]!.text, "Schrittregeln", "the step's own rules come after the shared blocks");
  assert.equal(cachedRequestParts({ tools: [], prefix: ["", "  "] }, "s", { name: "t", input_schema: { type: "object" } }).system.length, 1, "empty blocks are left out");
  assert.equal(contentPromptCacheEnabled({}), true);
  assert.equal(contentPromptCacheEnabled({ [CONTENT_PROMPT_CACHE_ENV]: "off" }), false);
  console.log("request parts: ok");
}

{
  // Cached input has its own prices; the input count is the whole prompt.
  const usage = contentUsage({ input_tokens: 4_000, output_tokens: 2_000, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 30_000 } as Anthropic.Messages.Usage);
  assert.deepEqual(usage, { inputTokens: 44_000, outputTokens: 2_000, cacheWriteTokens: 10_000, cacheReadTokens: 30_000 });
  assert.deepEqual([CACHE_WRITE_FACTOR, cacheReadFactor("claude-sonnet-5-5"), cacheReadFactor("claude-sonnet-4-6")], [1.25, 0.05, 0.1]);
  // Sonnet 5.5: 2 $ in, 10 $ out per million. (4.000 + 10.000 × 1,25 + 30.000 × 0,05) × 2 $ + 2.000 × 10 $ = 0,036 + 0,02 $.
  assert.equal(estimateCostEur("claude-sonnet-5-5", usage, 1), 0.056);
  assert.equal(estimateCostEur("claude-sonnet-5-5", { inputTokens: 44_000, outputTokens: 2_000 }, 1), 0.108, "without cache fields: priced as before");
  assert.deepEqual(stepTokenUsage([{ usage }, { usage: { inputTokens: 100, outputTokens: 10 } }]), { input: 44_100, output: 2_010, cache_write: 10_000, cache_read: 30_000 });
  assert.deepEqual(withoutPageFacts({ main_question: "x", token_usage: { input: 1 }, page_facts: {} }), { main_question: "x" }, "the bookkeeping never reaches a prompt");
  console.log("usage and cost: ok");
}

async function main() {
  const api = await startFakeAnthropicApi();
  const anthropic = new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 });
  const ctx = context();
  const spec = contentStepSpec(CONTENT_STEP_SEO, ctx);
  const reply = (tool: string) => ({
    events: [
      { ...messageStart(), message: { ...(messageStart().message as Record<string, unknown>), usage: { input_tokens: 500, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 9_000 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: tool, input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ title: "T", meta_description: "M", blocks: [{ id: "h1", heading: "H", level: 1, html: "<p>x</p>" }] }) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 40 } },
      { type: "message_stop" },
    ],
  });
  type Seen = { system: unknown; tools?: Array<{ name: string }>; messages: Array<{ content: unknown }> };
  try {
    api.handle(() => reply(spec.tool.name));
    const call = await callContentTool({ models: ["claude-sonnet-4-6"], system: spec.system, user: spec.userRest!, tool: spec.tool, maxTokens: 1_000, cache: stepPromptCache(ctx), anthropic });
    const seen = api.seen[0] as unknown as Seen;
    const system = seen.system as Array<{ text: string; cache_control?: unknown }>;
    assert.equal(seen.tools!.length, claudeSteps.length, "every step sends the same tool list");
    assert.equal(system.length, 3);
    assert.ok(system[0]!.text.startsWith("## Anbieterfakten") && system[1]!.text.startsWith("## Avatar"));
    assert.ok(system.every((b) => JSON.stringify(b.cache_control) === '{"type":"ephemeral"}'));
    assert.match(system[2]!.text, /Antworte ausschließlich, indem du das Werkzeug „submit_seo_text“ genau einmal aufrufst – kein anderes Werkzeug\.$/, "the step names its tool");
    assert.equal(seen.messages[0]!.content, spec.userRest);
    assert.deepEqual([call.usage.inputTokens, call.usage.cacheReadTokens], [9_500, 9_000]);

    // Two steps of one page: byte-identical up to the step's own rules.
    api.seen.length = 0;
    for (const def of claudeSteps.slice(0, 3)) {
      const s = contentStepSpec(def.step, ctx);
      api.handle(() => reply(s.tool.name));
      await callContentTool({ models: ["claude-sonnet-4-6"], system: s.system, user: s.userRest!, tool: s.tool, maxTokens: 1_000, cache: stepPromptCache(ctx), anthropic });
    }
    const prefixes = (api.seen as unknown as Seen[]).map((r) => JSON.stringify([r.tools, (r.system as unknown[]).slice(0, 2)]));
    assert.equal(new Set(prefixes).size, 1, "tools and shared system blocks are the same in every step");

    // The model called another tool of the list: no result, said plainly, tried again.
    api.handle(() => reply("submit_analyse"));
    await assert.rejects(
      () => callContentTool({ models: ["claude-sonnet-4-6"], system: spec.system, user: spec.userRest!, tool: spec.tool, maxTokens: 1_000, cache: stepPromptCache(ctx), anthropic }),
      /statt „submit_seo_text“ wurde „submit_analyse“ aufgerufen/,
    );

    // Without `cache` the request is the one of before: one tool, a plain system string.
    api.seen.length = 0;
    api.handle(() => reply(spec.tool.name));
    await callContentTool({ models: ["claude-sonnet-4-6"], system: spec.system, user: spec.user, tool: spec.tool, maxTokens: 1_000, anthropic });
    const plain = api.seen[0] as unknown as Seen;
    assert.deepEqual([typeof plain.system, plain.tools!.length], ["string", 1]);
    assert.equal(plain.system, spec.system);
    console.log("requests: ok");
  } finally {
    await api.close();
  }
}

main()
  .then(() => console.log("OK: content prompt cache tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
