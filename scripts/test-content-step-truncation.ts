/**
 * Texte: a cut-off answer never becomes the step's text. On 10.11. an Unterseite stopped in the
 * middle of the SEO text: the call's time limit cut the stream, the stream reader closed the
 * half-written JSON, and the stub went on to the next steps as the page text. Now a response
 * without a finished stop_reason fails the step: the time limit as a retry, max_tokens as
 * „Ausgabe abgeschnitten (Token-Limit)“. Also: the text steps' budget, the per-model output
 * limit, the full slot the job loop gives a text step, and the step log line.
 * Local fake API; no network, no model.
 * Run: npm run test:content-step-truncation
 */
import assert from "node:assert/strict";

import Anthropic from "@anthropic-ai/sdk";

import {
  CONTENT_STOP_REASON_TIMEOUT,
  CONTENT_TIMEOUT_MESSAGE,
  CONTENT_TRUNCATED_MESSAGE,
  ContentLlmError,
  callContentResearch,
  callContentTool,
  contentModelOutputLimit,
} from "../lib/dt/content/pipeline/llm";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { TEXT_STEP_MAX_TOKENS, TEXT_TOOL_SCHEMA, contentStepSpec, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { stepFailureDetail } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEPS } from "../lib/dt/content/pipeline/steps";
import { contentStepLogLine, contentStopReasonLabel } from "../lib/dt/content/presentation";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import { FULL_TEXT_STEP_MS } from "../lib/jobs/handlers/content-page";
import { stepBudgetMs } from "../lib/jobs/schedule";

import { messageStart, startFakeAnthropicApi, textReply, type FakeReply } from "./support/fake-anthropic-api";

const TOOL: Anthropic.Tool = { name: "submit_seo_text", description: "Seitentext", input_schema: TEXT_TOOL_SCHEMA };

const FULL = JSON.stringify({
  title: "Titel",
  meta_description: "Meta",
  blocks: [
    { id: "intro", heading: "Die H1", level: 1, html: "<p>Erster Abschnitt, vollständig.</p>" },
    { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>Zweiter Abschnitt, der mitten im Satz abbricht und noch viel länger wäre.</p>" },
    { id: "kontakt", heading: "Kontakt", level: 2, html: "<p>Der Schluss.</p>" },
  ],
});
const CUT = FULL.slice(0, FULL.indexOf("mitten im Satz") + "mitten im Satz".length);

function toolEvents(json: string): Array<Record<string, unknown>> {
  return [
    messageStart(),
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: TOOL.name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } },
  ];
}
const finished = (json: string, stopReason: string, outputTokens: number): FakeReply => ({
  events: [
    ...toolEvents(json),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } },
    { type: "message_stop" },
  ],
});

async function failure(run: () => Promise<unknown>): Promise<ContentLlmError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ContentLlmError, `ContentLlmError expected, got ${String(error)}`);
    return error;
  }
  throw new Error("the call should have failed");
}

async function main() {
  const api = await startFakeAnthropicApi();
  const anthropic = new Anthropic({ apiKey: "test", baseURL: api.url, maxRetries: 0 });
  const call = (timeoutMs = 5_000) =>
    callContentTool({ models: ["claude-sonnet-4-6"], system: "s", user: "u", tool: TOOL, maxTokens: TEXT_STEP_MAX_TOKENS, timeoutMs, anthropic });

  try {
    // A finished answer: the JSON, the usage and why the model stopped.
    api.handle(() => finished(FULL, "tool_use", 6_412));
    const ok = await call();
    assert.equal((ok.json as { blocks: unknown[] }).blocks.length, 3);
    assert.equal(ok.stopReason, "tool_use");
    assert.equal(ok.usage.outputTokens, 6_412);
    assert.equal(api.seen[0]!.max_tokens, 16_000, "the text steps ask for 16,000 tokens");

    // The time limit cuts the stream in the middle of the second Abschnitt: no text, a retry.
    api.handle(() => ({ events: toolEvents(CUT), stall: true }));
    const timedOut = await failure(() => call(600));
    assert.equal(timedOut.message, CONTENT_TIMEOUT_MESSAGE);
    assert.equal(timedOut.retryable, true, "the job tries the step again");
    assert.equal(timedOut.stopReason, CONTENT_STOP_REASON_TIMEOUT);
    assert.deepEqual(stepFailureDetail(timedOut), { stopReason: "timeout", outputTokens: 1 });

    // max_tokens: the step fails with the message the page window shows; no retry.
    api.handle(() => finished(CUT, "max_tokens", 16_000));
    const truncated = await failure(() => call());
    assert.equal(truncated.message, "Ausgabe abgeschnitten (Token-Limit)");
    assert.equal(truncated.message, CONTENT_TRUNCATED_MESSAGE);
    assert.equal(truncated.retryable, false);
    assert.deepEqual(stepFailureDetail(truncated), { stopReason: "max_tokens", outputTokens: 16_000 });
    assert.deepEqual(stepFailureDetail(new Error("Datenbank")), {}, "other errors carry no log fields");

    // The research call (Aktualitätsprüfung): a protocol the time limit cut is no protocol.
    api.handle(() => ({
      events: [
        messageStart(),
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "- [intro] „Seit 2024 gilt" } },
      ],
      stall: true,
    }));
    const research = await failure(() =>
      callContentResearch({ models: ["claude-sonnet-4-6"], system: "s", user: "u", maxTokens: 8_000, timeoutMs: 10_600, anthropic }),
    );
    assert.equal(research.retryable, true);
    assert.equal(research.stopReason, CONTENT_STOP_REASON_TIMEOUT);
    api.handle(() => textReply("Zeitkritische Aussagen: 0"));
    const protocol = await callContentResearch({ models: ["claude-sonnet-4-6"], system: "s", user: "u", maxTokens: 8_000, timeoutMs: 20_000, anthropic });
    assert.equal(protocol.text, "Zeitkritische Aussagen: 0");

    // max_tokens never exceeds what the answering model can write (the last fallback writes 8,192).
    api.seen.length = 0;
    api.handle(() => finished(FULL, "tool_use", 100));
    await callContentTool({ models: ["claude-3-5-sonnet-latest"], system: "s", user: "u", tool: TOOL, maxTokens: TEXT_STEP_MAX_TOKENS, anthropic });
    assert.equal(api.seen[0]!.max_tokens, 8_192);
    await callContentTool({ models: ["claude-sonnet-5-5"], system: "s", user: "u", tool: TOOL, maxTokens: TEXT_STEP_MAX_TOKENS, anthropic });
    assert.equal(api.seen[1]!.max_tokens, 21_600, "Sonnet 5.5: 1.35× for its tokenizer, within its limit");
    assert.equal(contentModelOutputLimit("claude-sonnet-4-6"), 64_000);
  } finally {
    await api.close();
  }
  console.log("cut-off answers: ok");

  // Every Claude step that returns the whole text has the 16,000 budget.
  const context: ContentPipelineContext = {
    organisationName: "Muster GmbH",
    page: {
      name: "Unterseite", path: "/leistung/unterseite", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
      pillar_name: "Leistung", estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
    },
    structureOutline: "",
    existingText: null,
    sections: [{ key: "unternehmen", label: "Unternehmen", current: "Wir sind ein Betrieb." }],
    settings: { anrede: "Sie", branche: "Handwerk", tonalitaet: "sachlich", verbotene_woerter: [] },
    avatar: null,
    typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
    notes: [],
    freshness: EMPTY_CONTENT_FRESHNESS,
    outputs: {},
    blocks: [{ id: "intro", heading: "H1", level: 1, html: "<p>Text.</p>" }],
    title: null,
    metaDescription: null,
  };
  for (const key of ["seo", "geo", "hormozi", "vermenschlichung", "lektorat"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    assert.equal(contentStepSpec(def.step, context).maxTokens, 16_000, `${def.name}: 16,000 tokens`);
  }

  // A long Anbieter section reaches the prompt whole (it was cut at 6,000 characters).
  const long = `${"Fakt über die siebte Leistung. ".repeat(600)}SCHLUSSFAKT`;
  const seo = contentStepSpec(2, { ...context, sections: [{ key: "leistungen", label: "Leistungen & Schwerpunkte", current: long }] });
  assert.ok(long.length > 18_000 && long.length < 24_000);
  assert.ok(seo.user.includes("SCHLUSSFAKT"), "the end of an 18,000-character section is in the SEO prompt");
  console.log("budgets and sections: ok");

  // A text step starts only with a nearly full tick: at least 185 s for the call.
  assert.equal(stepBudgetMs(0, 190_000, FULL_TEXT_STEP_MS), null, "190 s left: the text step waits for the next tick");
  assert.ok(stepBudgetMs(0, 240_000, FULL_TEXT_STEP_MS)! >= 185_000);

  // The step log line of the page window.
  assert.equal(contentStepLogLine({ output_tokens: 6_412, stop_reason: "tool_use" }), "6.412 Ausgabe-Tokens · vollständig (tool_use)");
  assert.equal(contentStepLogLine({ output_tokens: 16_000, stop_reason: "max_tokens" }), "16.000 Ausgabe-Tokens · abgeschnitten (Token-Limit) (max_tokens)");
  assert.equal(contentStepLogLine({ output_tokens: 0, stop_reason: null }), "");
  assert.equal(contentStopReasonLabel("timeout"), "abgebrochen (Zeitlimit)");
  console.log("OK: step truncation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
