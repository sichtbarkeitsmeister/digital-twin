/**
 * Watermark tool: chunk planning, merging by id, the shared Grok runner with a stubbed
 * `fetch` (no network, no database), pausing and resuming, and the prompt wiring that must
 * match step 8 of Texte. Run: npx tsx scripts/test-text-tools-watermark.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import type { ContentTextSettings } from "../lib/dt/content/mapping";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import { rephraseChunkPrompt, settingsBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import {
  REPHRASE_CHUNK_CHARS,
  REPHRASE_MIN_REMAINING_MS,
  REPHRASE_SYSTEM,
  emptyRephraseProgress,
  mergeRewrittenBlocks,
  needsRephrase,
  parseRephrasedChunk,
  planRephraseChunks,
  readRephraseProgress,
  rephraseBlockCount,
  rephraseProgressLabel,
  type RephraseProgress,
} from "../lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks, type RephraseRunOptions } from "../lib/dt/content/pipeline/rephrase-runner";
import { XAI_MISSING_KEY_MESSAGE, XaiTimeoutError, callXaiText, type XaiTextCall } from "../lib/dt/content/pipeline/xai";
import { renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { blocksFromDocument } from "../lib/dt/text-tools/ingest";
import {
  WATERMARK_TOOL_JOB_KIND,
  WATERMARK_TOOL_USAGE_MODE,
  readWatermarkJobProgress,
  runWatermarkOnContext,
  splitWatermarkNotes,
  watermarkToolJobFromRow,
  watermarkToolPayloadSchema,
  watermarkToolResult,
  type WatermarkToolContext,
  type WatermarkToolPayload,
} from "../lib/dt/text-tools/watermark";

const settings: ContentTextSettings = { anrede: "Sie", branche: "Zahnarztpraxis", tonalitaet: "sachlich", verbotene_woerter: ["günstig"] };
const MODELS = ["grok-test-fast", "grok-test-slow"] as const;

/** A long paragraph of roughly `words` words, so chunks fill up. */
function paragraph(seed: string, words: number): string {
  return `<p>${Array.from({ length: words }, (_, i) => `${seed}${i % 7}`).join(" ")}.</p>`;
}

/** An upload as the ingest module hands it over: seven sections, two of them too short to rewrite. */
function uploadBlocks(): ContentTextBlock[] {
  const text = [
    "Zahnarzt in Münster",
    "",
    "Kurz.",
    "",
    "Prophylaxe",
    "",
    "Die professionelle Zahnreinigung dauert in unserer Praxis etwa eine Stunde und wird von geschulten Fachkräften durchgeführt. Wir empfehlen sie zweimal im Jahr.",
    "",
    "Implantate",
    "",
    "Ein Implantat ersetzt die Zahnwurzel. Die Behandlung läuft in drei Schritten: Beratung, Einsetzen, Einheilen. [BITTE PRÜFEN: Einheilzeit]",
    "",
    "Öffnungszeiten",
    "",
    "Mo–Fr 8–18 Uhr.",
    "",
    "Anfahrt",
    "",
    "Die Praxis liegt am Hauptbahnhof Münster, Parkplätze finden Sie im Parkhaus gegenüber. Rufen Sie an unter 0251 123456.",
  ].join("\n");
  const result = blocksFromDocument({ kind: "text", content: text });
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.value.blocks;
}

/** Big blocks for the size limits of the planner. */
function bigBlocks(count: number, words: number): ContentTextBlock[] {
  return Array.from({ length: count }, (_, i) => ({ id: `b-${i + 1}`, heading: `Teil ${i + 1}`, level: 2 as const, html: paragraph("wort", words) }));
}

// --- chunk planning ------------------------------------------------------------------------------

function testChunkPlanning() {
  const blocks = uploadBlocks();
  const total = rephraseBlockCount(blocks);
  assert.equal(total, 3, "H1 one-liner, „Mo–Fr“ and „Kurz.“ sections stay as they are");
  assert.deepEqual(blocks.filter(needsRephrase).map((b) => b.heading), ["Prophylaxe", "Implantate", "Anfahrt"]);

  const chunks = planRephraseChunks(blocks);
  assert.equal(chunks.length, 1, "three short sections fit one call");
  assert.deepEqual(chunks[0]!.map((b) => b.heading), ["Prophylaxe", "Implantate", "Anfahrt"]);

  // Already rewritten blocks are left out, so a resumed run pays only for what is open.
  const resumed = planRephraseChunks(blocks, { [chunks[0]![0]!.id]: "<p>done</p>" });
  assert.deepEqual(resumed.flat().map((b) => b.heading), ["Implantate", "Anfahrt"]);
  assert.deepEqual(planRephraseChunks(blocks, Object.fromEntries(chunks[0]!.map((b) => [b.id, "<p>x</p>"]))), []);

  // At most four blocks per chunk, and never more than REPHRASE_CHUNK_CHARS of text.
  const many = planRephraseChunks(bigBlocks(9, 20));
  assert.deepEqual(many.map((c) => c.length), [4, 4, 1]);
  const big = planRephraseChunks(bigBlocks(3, 250));
  assert.equal(big.length, 3, "a block near the chunk size gets its own call");
  for (const chunk of big) assert.ok(chunk.reduce((n, b) => n + b.html.length, 0) <= REPHRASE_CHUNK_CHARS + 60);
  console.log("chunk planning: ok");
}

// --- merge by id ---------------------------------------------------------------------------------

function testMergeById() {
  const chunk = uploadBlocks().filter(needsRephrase);
  const [a, b, c] = chunk as [ContentTextBlock, ContentTextBlock, ContentTextBlock];
  // Answer in another order, with a changed heading, one section missing, and a script tag.
  const answer = [
    "```html",
    `<section data-block-id="${c.id}"><h2>Umbenannt</h2><p>Neu C.</p><script>alert(1)</script></section>`,
    `<section data-block-id="${a.id}"><h2>${a.heading}</h2><p>Neu A.</p></section>`,
    "```",
  ].join("\n");
  const merged = parseRephrasedChunk(answer, chunk);
  assert.deepEqual(
    merged.map((m) => [m.id, m.heading, m.level]),
    chunk.map((m) => [m.id, m.heading, m.level]),
    "ids, headings, levels and order come from the previous text",
  );
  assert.equal(merged[0]!.html, "<p>Neu A.</p>");
  assert.equal(merged[1]!.html, b.html, "a section the answer lost keeps its old text");
  assert.equal(merged[2]!.html, "<p>Neu C.</p>", "script tags are sanitised away");

  // A single block answered as bare paragraphs counts too.
  const bare = parseRephrasedChunk(`<h2>${a.heading}</h2><p>Nur Absatz.</p>`, [a]);
  assert.deepEqual(bare.map((m) => m.html), ["<p>Nur Absatz.</p>"]);

  // Positional match when the answer renamed every id but kept the count; empty bodies fall back.
  const positional = mergeRewrittenBlocks(
    [a, b],
    [
      { id: "x1", heading: "", level: 2, html: "<p>P1</p>" },
      { id: "x2", heading: "", level: 2, html: "   " },
    ],
  );
  assert.deepEqual(positional.map((m) => [m.id, m.html]), [[a.id, "<p>P1</p>"], [b.id, b.html]]);
  console.log("merge by id: ok");
}

// --- prompt: same as step 8, nothing from the menu label -------------------------------------------

function testPromptMatchesStepEight() {
  const chunk = uploadBlocks().filter(needsRephrase);
  const notes = ["Die Praxis heißt Dr. Test.", "Keine Du-Form."];
  const tool = rephraseChunkPrompt({ settings, notes }, chunk);
  assert.equal(tool.system, REPHRASE_SYSTEM);
  assert.ok(tool.user.includes(settingsBlock(settings)));
  assert.match(tool.user, /## Anmerkungen der Redaktion[\s\S]*1\. Die Praxis heißt Dr\. Test\.\n2\. Keine Du-Form\./);
  assert.match(tool.user, /## Abschnitte \(bitte in derselben Form zurückgeben/);
  assert.match(tool.user, new RegExp(`<section data-block-id="${chunk[0]!.id}">`));
  const forbidden = /wasserzeichen|watermark|ai act|ki-verordnung/i;
  assert.doesNotMatch(tool.system, forbidden, "the model prompt never mentions the step's UI name");
  assert.doesNotMatch(tool.user, forbidden);

  // The very same prompt as the pipeline builds for a page with these settings and notes.
  const pipeline = rephraseChunkPrompt(
    { settings, notes, page: { ki_prompt: null }, blocks: chunk, outputs: {} } as unknown as ContentPipelineContext,
    chunk,
  );
  assert.deepEqual(tool, pipeline);
  // A page's KI-Prompt is the one addition the pipeline makes; the tool has no page.
  const withKi = rephraseChunkPrompt({ settings, notes: [], page: { ki_prompt: "Immer die Praxis nennen." } }, chunk);
  assert.match(withKi.user, /KI-Prompt aus der Seitenstruktur: Immer die Praxis nennen\./);
  assert.doesNotMatch(rephraseChunkPrompt({ settings, notes: [] }, chunk).user, /## Anmerkungen/);
  console.log("prompt matches step 8: ok");
}

// --- the runner on a stubbed Grok ------------------------------------------------------------------

type StubOptions = { model?: string; text?: (ids: string[], body: string) => string };

/** A `fetch` that answers like xAI: every section of the request comes back with a new paragraph. */
function stubFetch(seen: Array<{ model: string; user: string; maxTokens: number }>, options: StubOptions = {}) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number };
    const user = body.messages.find((m) => m.role === "user")!.content;
    seen.push({ model: body.model, user, maxTokens: body.max_tokens });
    const ids = Array.from(user.matchAll(/data-block-id="([^"]+)"/g), (m) => m[1]!);
    const text = options.text
      ? options.text(ids, user)
      : ids.map((id) => `<section data-block-id="${id}"><h2>Egal</h2><p>Neu ${id}.</p></section>`).join("\n");
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: text } }],
        usage: { prompt_tokens: 120, completion_tokens: 60 },
      }),
      { status: 200 },
    );
  };
}

/** Routes the runner's calls through the real xAI client, against the stubbed fetch. */
function viaFetch(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): RephraseRunOptions["call"] {
  return (input: XaiTextCall) => callXaiText({ ...input, env: { XAI_API_KEY: "test-key" }, fetchImpl });
}

type Save = { reason: string; model: string; done: number };

async function testRunnerFullRun() {
  const blocks = bigBlocks(6, 120);
  const progress = emptyRephraseProgress(rephraseBlockCount(blocks));
  const seen: Array<{ model: string; user: string; maxTokens: number }> = [];
  const saves: Save[] = [];
  const usage: Array<{ model: string; inputTokens: number; outputTokens: number; costEur: number }> = [];

  const run = await runRephraseOnBlocks({ settings, notes: ["Nur Sie."] }, blocks, {
    progress,
    deadline: Date.now() + 600_000,
    models: MODELS,
    call: viaFetch(stubFetch(seen)),
    onUsage: async (u) => {
      usage.push(u);
    },
    save: async (p, info) => {
      saves.push({ reason: info.reason, model: info.model, done: Object.keys(p.rewritten).length });
    },
  });

  assert.equal(run.state, "done");
  if (run.state !== "done") return;
  const chunks = planRephraseChunks(blocks);
  assert.equal(seen.length, chunks.length, "one Grok call per chunk");
  assert.ok(seen.every((s) => s.model === "grok-test-fast"), "first candidate answers");
  assert.ok(seen.every((s) => s.user.includes("## Vorgaben") && s.user.includes("1. Nur Sie.")));
  assert.deepEqual(run.blocks.map((b) => b.html), blocks.map((b) => `<p>Neu ${b.id}.</p>`));
  assert.deepEqual(run.blocks.map((b) => [b.id, b.heading, b.level]), blocks.map((b) => [b.id, b.heading, b.level]));
  assert.equal(run.model, "grok-test-fast");

  assert.equal(progress.calls, chunks.length);
  assert.equal(progress.input_tokens, 120 * chunks.length);
  assert.equal(progress.output_tokens, 60 * chunks.length);
  assert.deepEqual(progress.models, ["grok-test-fast"]);
  assert.equal(Object.keys(progress.rewritten).length, blocks.length);
  assert.equal(usage.length, chunks.length, "every call is billed");
  assert.equal(saves.length, chunks.length, "progress is saved after every chunk");
  assert.ok(saves.every((s) => s.reason === "chunk" && s.model === "grok-test-fast"));
  assert.deepEqual(saves.map((s) => s.done), chunks.map((_, i) => chunks.slice(0, i + 1).flat().length), "each save holds every block answered so far");
  assert.equal(rephraseProgressLabel(progress), `${blocks.length} von ${blocks.length} Abschnitten`);
  console.log("runner full run: ok");
}

async function testRunnerPausesAndResumes() {
  const blocks = bigBlocks(6, 120);
  const chunks = planRephraseChunks(blocks);
  assert.ok(chunks.length >= 2);
  const progress = emptyRephraseProgress(rephraseBlockCount(blocks));
  const seen: Array<{ model: string; user: string; maxTokens: number }> = [];
  const saves: Save[] = [];
  let clock = 1_000_000;
  const common = {
    models: MODELS,
    call: viaFetch(stubFetch(seen)),
    onUsage: async () => undefined,
    save: async (p: RephraseProgress, info: { reason: string; model: string }) => {
      saves.push({ reason: info.reason, model: info.model, done: Object.keys(p.rewritten).length });
    },
    now: () => clock,
  };

  // Budget for exactly one chunk: after it, less than the minimum remains → partial.
  const first = await runRephraseOnBlocks({ settings, notes: [] }, blocks, {
    ...common,
    progress,
    deadline: clock + REPHRASE_MIN_REMAINING_MS + 1,
    call: async (input) => {
      clock += 10_000;
      return common.call!(input);
    },
  });
  assert.equal(first.state, "partial");
  assert.equal(seen.length, 1, "only the first chunk was called");
  assert.equal(saves.at(-1)?.reason, "paused", "the pause saves the progress");
  assert.equal(Object.keys(progress.rewritten).length, chunks[0]!.length);
  assert.equal(rephraseProgressLabel(progress), `${chunks[0]!.length} von ${blocks.length} Abschnitten`);

  // The next tick reads the saved progress back and only pays for the open chunks.
  const resumed = readRephraseProgress(JSON.parse(JSON.stringify(progress)), rephraseBlockCount(blocks));
  assert.deepEqual(resumed, progress);
  const second = await runRephraseOnBlocks({ settings, notes: [] }, blocks, { ...common, progress: resumed, deadline: clock + 600_000 });
  assert.equal(second.state, "done");
  assert.equal(seen.length, chunks.length, "the resumed run called only the remaining chunks");
  assert.equal(resumed.calls, chunks.length);
  if (second.state === "done") assert.deepEqual(second.blocks.map((b) => b.html), blocks.map((b) => `<p>Neu ${b.id}.</p>`));

  // No budget at all: nothing is called, the run pauses at once.
  const none = await runRephraseOnBlocks({ settings, notes: [] }, blocks, { ...common, progress: emptyRephraseProgress(6), deadline: clock + 1_000 });
  assert.equal(none.state, "partial");
  assert.equal(seen.length, chunks.length);
  console.log("runner pauses and resumes: ok");
}

async function testRunnerSlowModelAndErrors() {
  const blocks = bigBlocks(2, 120);
  const progress = emptyRephraseProgress(2);
  const saves: Save[] = [];
  const save = async (p: RephraseProgress, info: { reason: string; model: string }) => {
    saves.push({ reason: info.reason, model: info.model, done: Object.keys(p.rewritten).length });
  };

  // A model that ran into the time limit is noted and the progress saved before the error goes up.
  await assert.rejects(
    runRephraseOnBlocks({ settings, notes: [] }, blocks, {
      progress,
      deadline: Date.now() + 600_000,
      models: MODELS,
      call: async () => {
        throw new XaiTimeoutError("grok-test-fast", 70_000);
      },
      onUsage: async () => undefined,
      save,
    }),
    (error: unknown) => error instanceof XaiTimeoutError && error.model === "grok-test-fast",
  );
  assert.deepEqual(progress.slow_models, ["grok-test-fast"]);
  assert.deepEqual(saves, [{ reason: "paused", model: "grok-test-fast", done: 0 }]);

  // The retry asks the remaining candidate first.
  const seen: Array<{ model: string; user: string; maxTokens: number }> = [];
  let candidates: readonly string[] | undefined;
  const run = await runRephraseOnBlocks({ settings, notes: [] }, blocks, {
    progress,
    deadline: Date.now() + 600_000,
    models: MODELS,
    call: (input) => {
      candidates = input.models;
      return viaFetch(stubFetch(seen))!(input);
    },
    onUsage: async () => undefined,
    save,
  });
  assert.equal(run.state, "done");
  assert.deepEqual(candidates, ["grok-test-slow", "grok-test-fast"], "the slow model goes last");
  assert.ok(seen.every((s) => s.model === "grok-test-slow"));
  assert.deepEqual(progress.models, ["grok-test-slow"]);

  // A quick failure is not a slow model: nothing is noted, the error goes up as it is.
  const fresh = emptyRephraseProgress(2);
  await assert.rejects(
    runRephraseOnBlocks({ settings, notes: [] }, blocks, {
      progress: fresh,
      deadline: Date.now() + 600_000,
      models: MODELS,
      call: viaFetch(async () => new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 })),
      onUsage: async () => undefined,
      save,
    }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && /ausgelastet/.test(error.message),
  );
  assert.deepEqual(fresh.slow_models, []);

  // No Grok key: the German message, no call, never a fallback to another provider.
  await assert.rejects(
    runRephraseOnBlocks({ settings, notes: [] }, blocks, {
      progress: emptyRephraseProgress(2),
      deadline: Date.now() + 600_000,
      models: MODELS,
      call: (input) =>
        callXaiText({
          ...input,
          env: {},
          fetchImpl: async () => {
            throw new Error("must not be called");
          },
        }),
      onUsage: async () => undefined,
      save,
    }),
    (error: unknown) => error instanceof ContentLlmError && error.message === XAI_MISSING_KEY_MESSAGE && !error.retryable,
  );
  console.log("runner slow model and errors: ok");
}

// --- the tool around the runner --------------------------------------------------------------------

function payloadFor(blocks: ContentTextBlock[], notes: string[] = []): WatermarkToolPayload {
  const parsed = watermarkToolPayloadSchema.safeParse({
    organisationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    fileName: "leistungen.docx",
    pageName: "Leistungen",
    blocks,
    title: null,
    metaDescription: null,
    notes,
  });
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  return parsed.data;
}

function contextFor(payload: WatermarkToolPayload): WatermarkToolContext {
  return {
    settings,
    notes: payload.notes,
    fileName: payload.fileName,
    pageName: payload.pageName,
    blocks: payload.blocks,
    title: payload.title,
    metaDescription: payload.metaDescription,
  };
}

async function testToolRun() {
  const blocks = bigBlocks(6, 120);
  const payload = payloadFor(blocks, ["Nur Sie."]);
  const context = contextFor(payload);
  const chunks = planRephraseChunks(blocks);
  const seen: Array<{ model: string; user: string; maxTokens: number }> = [];
  const stored: unknown[] = [];
  const usage: Array<{ model: string }> = [];

  // First tick with budget for one chunk → partial, progress handed back for the job row.
  let clock = 5_000_000;
  const first = await runWatermarkOnContext(context, payload, {
    timeoutMs: REPHRASE_MIN_REMAINING_MS + 1,
    previous: null,
    models: MODELS,
    now: () => clock,
    call: async (input) => {
      clock += 10_000;
      return viaFetch(stubFetch(seen))!(input);
    },
    saveProgress: async (state) => {
      stored.push(JSON.parse(JSON.stringify(state)));
    },
    recordUsage: async (u) => {
      usage.push(u);
    },
  });
  assert.equal(first.state, "partial");
  assert.equal(seen.length, 1);
  assert.equal(stored.length, 2, "the chunk's progress and the pause went to the job row");
  if (first.state !== "partial") return;
  assert.deepEqual(stored[1], { progress: JSON.parse(JSON.stringify(first.progress)) }, "the last save is what the handler reschedules with");
  assert.equal(rephraseProgressLabel(first.progress), `${chunks[0]!.length} von ${blocks.length} Abschnitten`);
  const row = { progress: JSON.parse(JSON.stringify(first.progress)) as RephraseProgress };
  assert.deepEqual(readWatermarkJobProgress(row, blocks), first.progress);
  assert.deepEqual(readWatermarkJobProgress(null, blocks), emptyRephraseProgress(blocks.length));
  assert.deepEqual(readWatermarkJobProgress({ html: "x" }, blocks), emptyRephraseProgress(blocks.length), "a finished result is not a progress");

  // The status route while it runs: „2 von 6 Abschnitten“.
  const running = watermarkToolJobFromRow({ status: "pending", result: row, last_error: "Rate limit" });
  assert.deepEqual(running, { state: "running", progress: `${chunks[0]!.length} von ${blocks.length} Abschnitten`, result: null, error: null });
  assert.equal(watermarkToolJobFromRow({ status: "running", result: null, last_error: null }).progress, null);

  // Next tick resumes from the row and finishes.
  const second = await runWatermarkOnContext(context, payload, {
    timeoutMs: 600_000,
    previous: row,
    models: MODELS,
    call: viaFetch(stubFetch(seen)),
    recordUsage: async (u) => {
      usage.push(u);
    },
  });
  assert.equal(second.state, "done");
  if (second.state !== "done") return;
  const { result } = second;
  assert.equal(seen.length, chunks.length, "the second tick called only the open chunks");
  assert.equal(usage.length, chunks.length);
  assert.equal(result.calls, chunks.length);
  assert.equal(result.input_blocks, blocks.length);
  assert.equal(result.rewritten_blocks, blocks.length);
  assert.equal(result.model, "grok-test-fast");
  assert.deepEqual(result.models, ["grok-test-fast"]);
  assert.equal(result.file_name, "leistungen.docx");
  assert.equal(result.page_name, "Leistungen");
  assert.equal(result.input_tokens, 120 * chunks.length);
  assert.equal(result.html, renderBlocksHtml(result.blocks), "the stored HTML is the rendered blocks");
  assert.match(result.html, /^<section data-block-id="b-1"><h2>Teil 1<\/h2>\s*<p>Neu b-1\.<\/p><\/section>/);
  assert.deepEqual(result.blocks.map((b) => b.heading), blocks.map((b) => b.heading));

  // Done and dead rows, and the export of the result like a Texte page.
  assert.deepEqual(watermarkToolJobFromRow({ status: "succeeded", result, last_error: null }), { state: "done", progress: null, result, error: null });
  assert.equal(watermarkToolJobFromRow({ status: "succeeded", result: { progress: row.progress }, last_error: null }).state, "error");
  assert.deepEqual(watermarkToolJobFromRow({ status: "dead", result: row, last_error: XAI_MISSING_KEY_MESSAGE }), {
    state: "error",
    progress: null,
    result: null,
    error: XAI_MISSING_KEY_MESSAGE,
  });
  const txt = contentExportFile("txt", { slug: "leistungen-ueberarbeitet", title: "Leistungen", html: result.html });
  assert.match(txt.body, /^Teil 1\n\nNeu b-1\./);
  assert.equal(txt.filename, "leistungen-ueberarbeitet.txt");
  const html = contentExportFile("html", { slug: "leistungen-ueberarbeitet", title: "Leistungen", html: result.html });
  assert.match(html.body, /<title>Leistungen<\/title>/);
  console.log("tool run: ok");
}

function testToolHelpers() {
  const blocks = uploadBlocks();
  const short = blocks.filter((b) => !needsRephrase(b));
  assert.ok(short.length > 0);
  const result = watermarkToolResult(blocks, { ...emptyRephraseProgress(3), calls: 1, rewritten: { x: "<p>x</p>" }, models: ["m"] }, "m", payloadFor(blocks));
  assert.equal(result.rewritten_blocks, 1);
  assert.equal(result.html, renderBlocksHtml(blocks), "untouched blocks render as they came");

  assert.deepEqual(splitWatermarkNotes("Erste Anmerkung\nzweite Zeile\n\n\nZweite Anmerkung\r\n\r\n  "), ["Erste Anmerkung\nzweite Zeile", "Zweite Anmerkung"]);
  assert.deepEqual(splitWatermarkNotes(null), []);
  assert.equal(watermarkToolPayloadSchema.safeParse({}).success, false);
  assert.equal(watermarkToolPayloadSchema.safeParse({ ...payloadFor(blocks), blocks: [] }).success, false);
  assert.equal(WATERMARK_TOOL_JOB_KIND, "text-tool.watermark");
  assert.equal(WATERMARK_TOOL_USAGE_MODE, "text-tool.watermark");
  console.log("tool helpers: ok");
}

async function main() {
  testChunkPlanning();
  testMergeById();
  testPromptMatchesStepEight();
  await testRunnerFullRun();
  await testRunnerPausesAndResumes();
  await testRunnerSlowModelAndErrors();
  await testToolRun();
  testToolHelpers();
  console.log("ok: text-tools watermark");
}

void main();
