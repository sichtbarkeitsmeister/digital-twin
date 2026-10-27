/**
 * Watermark tool: chunk planning, merging by id, the shared Grok runner with a stubbed
 * `fetch` (no network, no database), pausing and resuming, the prompt wiring that must
 * match the Watermark step of Texte, and the standalone flow (plan → one call per chunk → export). Run: npx tsx scripts/test-text-tools-watermark.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import type { ContentTextSettings } from "../lib/dt/content/mapping";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import { REPHRASE_OWN_VORGABEN, rephraseChunkPrompt, settingsBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
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
  rephrasedBlocks,
  type RephraseProgress,
} from "../lib/dt/content/pipeline/rephrase";
import { runRephraseOnBlocks, type RephraseRunOptions } from "../lib/dt/content/pipeline/rephrase-runner";
import { XAI_MISSING_KEY_MESSAGE, XaiTimeoutError, callXaiText, type XaiTextCall } from "../lib/dt/content/pipeline/xai";
import { renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { blocksFromDocument } from "../lib/dt/text-tools/ingest";
import {
  WATERMARK_CHUNK_MAX_BLOCKS,
  prepareWatermarkDocument,
  rephraseWatermarkChunk,
  watermarkChunkRequestSchema,
} from "../lib/dt/text-tools/watermark";
import { mergeWatermarkBlocks, watermarkExportFile } from "../lib/dt/text-tools/watermark-export";

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

// --- prompt: same as the Watermark step of Texte, nothing from the menu label --------------------

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

  // The standalone tool: no settings, no notes. Same system prompt and section block; the
  // Vorgaben keep the text's own address and tone instead of naming any organisation's.
  const standalone = rephraseChunkPrompt({ notes: [] }, chunk);
  assert.equal(standalone.system, REPHRASE_SYSTEM);
  assert.equal(standalone.user.split("\n\n## Vorgaben")[0], tool.user.split("\n\n## Vorgaben")[0], "same sections block as the Watermark step");
  assert.ok(standalone.user.endsWith(REPHRASE_OWN_VORGABEN));
  assert.doesNotMatch(standalone.user, /Branche|Verbotene Wörter|## Anmerkungen/);
  assert.doesNotMatch(standalone.user, forbidden);
  assert.doesNotMatch(REPHRASE_OWN_VORGABEN, forbidden);
  console.log("prompt matches the Watermark step: ok");
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

// --- the standalone tool around the runner ----------------------------------------------------------

function testPrepareDocument() {
  const blocks = uploadBlocks();
  const doc = prepareWatermarkDocument("praxis.docx", "docx", { blocks, title: null, chars: 500 });
  assert.equal(doc.fileName, "praxis.docx");
  assert.equal(doc.format, "docx");
  assert.equal(doc.total, 3);
  assert.deepEqual(doc.chunks, planRephraseChunks(blocks).map((c) => c.map((b) => b.id)), "planned exactly like the Watermark step");
  assert.equal(doc.chunks.flat().length, doc.total, "every rewritable block is in exactly one call");

  const big = bigBlocks(9, 20);
  const bigDoc = prepareWatermarkDocument("a.txt", "txt", { blocks: big, title: "T", chars: 9_000 });
  assert.deepEqual(bigDoc.chunks.map((c) => c.length), [4, 4, 1]);
  assert.ok(bigDoc.chunks.every((c) => c.length <= WATERMARK_CHUNK_MAX_BLOCKS), "every planned chunk passes the request limit");
  for (const ids of bigDoc.chunks) {
    const request = watermarkChunkRequestSchema.safeParse({ blocks: ids.map((id) => big.find((b) => b.id === id)) });
    assert.ok(request.success, "a planned chunk is a valid request");
    assert.deepEqual(request.data.slowModels, [], "slowModels default to none");
  }
  console.log("prepare document: ok");
}

function testChunkRequestValidation() {
  const [block] = bigBlocks(1, 10);
  assert.equal(watermarkChunkRequestSchema.safeParse({ blocks: [] }).success, false);
  assert.equal(watermarkChunkRequestSchema.safeParse({ blocks: bigBlocks(5, 5) }).success, false, "more than four blocks");
  assert.equal(watermarkChunkRequestSchema.safeParse({ blocks: [{ ...block!, html: "x".repeat(30_000) }] }).success, false, "too much HTML");
  assert.equal(watermarkChunkRequestSchema.safeParse({ blocks: [{ ...block!, level: 4 }] }).success, false);
  assert.equal(watermarkChunkRequestSchema.safeParse({ blocks: [block], slowModels: ["grok-3"] }).success, true);
  console.log("chunk request validation: ok");
}

async function testChunkCall() {
  const blocks = bigBlocks(3, 60);
  const seen: Array<{ model: string; user: string; maxTokens: number }> = [];
  const usage: Array<{ model: string; inputTokens: number }> = [];
  const result = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    call: viaFetch(stubFetch(seen)),
    onUsage: async (u) => {
      usage.push(u);
    },
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(seen.length, 1, "one planned chunk is one Grok call");
  assert.ok(seen[0]!.user.endsWith(REPHRASE_OWN_VORGABEN), "no organisation settings in the prompt");
  assert.deepEqual(result.value.blocks.map((b) => [b.id, b.heading, b.level, b.html]), blocks.map((b) => [b.id, b.heading, b.level, `<p>Neu ${b.id}.</p>`]));
  assert.equal(result.value.model, "grok-test-fast");
  assert.deepEqual(result.value.slowModels, []);
  assert.equal(usage.length, 1);
  assert.equal(usage[0]!.inputTokens, 120);

  // Slow models from earlier chunks go last.
  let candidates: readonly string[] | undefined;
  const ordered = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    slowModels: ["grok-test-fast"],
    call: (input) => {
      candidates = input.models;
      return viaFetch(stubFetch([]))!(input);
    },
  });
  assert.ok(ordered.ok);
  assert.deepEqual(candidates, ["grok-test-slow", "grok-test-fast"]);
  if (ordered.ok) assert.deepEqual(ordered.value.slowModels, ["grok-test-fast"]);

  // A model that ran into the time limit comes back as retryable, with the model noted for the browser.
  const slow = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    call: async () => {
      throw new XaiTimeoutError("grok-test-fast", 70_000);
    },
  });
  assert.deepEqual(slow.ok ? null : slow.error.slowModels, ["grok-test-fast"]);
  assert.equal(slow.ok ? null : slow.error.retryable, true);

  // Rate limit: retryable, German message.
  const busy = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    call: viaFetch(async () => new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 })),
  });
  assert.ok(!busy.ok && busy.error.retryable && /ausgelastet/.test(busy.error.message));

  // No key: the German message, not retryable, no network, no other provider.
  const noKey = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    call: (input) =>
      callXaiText({
        ...input,
        env: {},
        fetchImpl: async () => {
          throw new Error("must not be called");
        },
      }),
  });
  assert.deepEqual(noKey.ok ? null : { message: noKey.error.message, retryable: noKey.error.retryable }, { message: XAI_MISSING_KEY_MESSAGE, retryable: false });

  // An unexpected error never escapes as a throw.
  const broken = await rephraseWatermarkChunk(blocks, {
    models: MODELS,
    call: async () => {
      throw new TypeError("boom");
    },
  });
  assert.ok(!broken.ok && broken.error.retryable);
  console.log("chunk call: ok");
}

async function testBrowserRunAndExport() {
  // What the browser does: parse → every planned chunk through the chunk call → merge → export.
  const blocks = uploadBlocks();
  const doc = prepareWatermarkDocument("Praxis Dr. Test.docx", "docx", { blocks, title: null, chars: 500 });
  const rewritten: Record<string, string> = {};
  for (const ids of doc.chunks) {
    const chunk = ids.map((id) => doc.blocks.find((b) => b.id === id)!);
    const result = await rephraseWatermarkChunk(chunk, { models: MODELS, call: viaFetch(stubFetch([])) });
    assert.ok(result.ok);
    if (result.ok) for (const b of result.value.blocks) rewritten[b.id] = b.html;
  }
  const merged = mergeWatermarkBlocks(doc.blocks, rewritten);
  assert.deepEqual(merged, rephrasedBlocks(doc.blocks, rewritten), "same merge rule as the Watermark step");
  assert.deepEqual(merged.map((b) => [b.id, b.heading]), blocks.map((b) => [b.id, b.heading]), "headings and order unchanged");
  assert.equal(merged.filter((b, i) => b.html !== blocks[i]!.html).length, doc.total, "exactly the planned blocks changed");

  const html = watermarkExportFile("html", { fileName: doc.fileName, title: doc.title, blocks: merged });
  assert.equal(html.filename, "praxis-dr-test-ueberarbeitet.html");
  assert.match(html.contentType, /^text\/html/);
  assert.match(html.body, /<title>Praxis Dr\. Test<\/title>/);
  assert.equal(html.body, contentExportFile("html", { slug: "praxis-dr-test-ueberarbeitet", title: "Praxis Dr. Test", html: renderBlocksHtml(merged) }).body);

  const txt = watermarkExportFile("txt", { fileName: doc.fileName, title: doc.title, blocks: merged });
  assert.equal(txt.filename, "praxis-dr-test-ueberarbeitet.txt");
  assert.match(txt.contentType, /^text\/plain/);
  assert.doesNotMatch(txt.body, /<[a-z]/i, "plain text, no markup");
  assert.match(txt.body, /^Zahnarzt in Münster\n/);
  assert.match(txt.body, /Neu abschnitt-\d+\./);
  assert.equal(watermarkExportFile("txt", { fileName: ".docx", title: null, blocks: merged }).filename, "text-ueberarbeitet.txt");
  console.log("browser run and export: ok");
}

async function main() {
  testChunkPlanning();
  testMergeById();
  testPromptMatchesStepEight();
  await testRunnerFullRun();
  await testRunnerPausesAndResumes();
  await testRunnerSlowModelAndErrors();
  testPrepareDocument();
  testChunkRequestValidation();
  await testChunkCall();
  await testBrowserRunAndExport();
  console.log("ok: text-tools watermark");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
