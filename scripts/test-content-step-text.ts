/**
 * Texte: the Zwischenstand of a page, the text as it was after one step, read from the step rows
 * (`dt_content_steps.output`), with what changed against the text step before it. No network, no model.
 * Run: npm run test:content-step-text
 */
import assert from "node:assert/strict";

import { contentStepLogLine } from "../lib/dt/content/presentation";
import {
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_WATERMARK,
} from "../lib/dt/content/pipeline/steps";
import { contentStepText, stepHasText, stepTextBlocks } from "../lib/dt/content/step-text";
import { stepList, type ContentStepRow } from "../lib/dt/content/store";

const seoBlocks = [
  { id: "h1", heading: "Erschöpfung behandeln in Köln", level: 1, html: "<p>Einstieg mit drei Wörtern.</p>" },
  { id: "ursachen", heading: "Welche Ursachen gibt es?", level: 2, html: "<p>Eisenmangel, Schlafmangel und Stress.</p>" },
  { id: "kontakt", heading: "Termin vereinbaren", level: 2, html: "<p>Rufen Sie an.</p>" },
];
const geoBlocks = [
  seoBlocks[0]!,
  { ...seoBlocks[1]!, html: "<p>Häufige Ursachen sind Eisenmangel, Schlafmangel und Stress.</p>" },
  { id: "ablauf", heading: "Wie läuft die Diagnostik ab?", level: 2, html: "<p>Erst das Gespräch, dann das Labor.</p>" },
];
const row = (step: number, status: string, output: unknown, patch: Partial<ContentStepRow> = {}): ContentStepRow =>
  ({ id: `s${step}`, page_id: "p", organisation_id: "o", step, name: "", status, output, model: "claude-sonnet-5-5", input_tokens: 0, output_tokens: 0, cost_eur: 0, error: null, started_at: null, finished_at: null, approved_by: null, approved_at: null, ...patch }) as ContentStepRow;

const steps: ContentStepRow[] = [
  row(CONTENT_STEP_ANALYSE, "done", { main_question: "Was hilft bei Erschöpfung?" }, { input_tokens: 21_000, output_tokens: 1_800, cost_eur: 0.09 }),
  row(CONTENT_STEP_SEO, "done", { blocks: seoBlocks, title: "Erschöpfung behandeln", meta_description: "Ursachen und Ablauf." }, { input_tokens: 48_210, output_tokens: 6_412, cost_eur: 0.24, stop_reason: "tool_use" }),
  row(CONTENT_STEP_FAKTENCHECK, "done", { findings: [], questions: [] }),
  row(CONTENT_STEP_GEO, "done", { blocks: geoBlocks, title: "Erschöpfung behandeln", meta_description: "Ursachen und Ablauf." }),
  row(CONTENT_STEP_HORMOZI, "pending", null),
  row(CONTENT_STEP_LEKTORAT, "error", { blocks: [] }),
  row(CONTENT_STEP_WATERMARK, "done", { version: 1, rewritten: { ursachen: "<p>Oft stecken Eisenmangel, zu wenig Schlaf oder Stress dahinter.</p>" }, total: 1 }),
];

{
  assert.equal(stepTextBlocks(steps, CONTENT_STEP_ANALYSE), null, "the Analyse writes no text");
  assert.equal(stepTextBlocks(steps, CONTENT_STEP_FAKTENCHECK), null);
  assert.equal(stepTextBlocks(steps, CONTENT_STEP_HORMOZI), null, "not run yet");
  assert.equal(stepTextBlocks(steps, CONTENT_STEP_LEKTORAT), null, "failed: no text");
  assert.deepEqual(stepTextBlocks(steps, CONTENT_STEP_SEO)!.map((b) => b.id), ["h1", "ursachen", "kontakt"]);
  assert.equal(stepHasText(steps, CONTENT_STEP_GEO), true);
  console.log("which steps hold a text: ok");
}

{
  const seo = contentStepText(steps, CONTENT_STEP_SEO)!;
  assert.deepEqual([seo.name, seo.sections, seo.compared_to, seo.changed_block_ids, seo.words_delta], ["SEO", 3, null, [], null], "the first text has nothing to compare with");
  assert.equal(seo.title, "Erschöpfung behandeln");
  assert.match(seo.html, /Eisenmangel, Schlafmangel und Stress/);

  const geo = contentStepText(steps, CONTENT_STEP_GEO)!;
  assert.equal(geo.compared_to, "SEO");
  assert.deepEqual(geo.changed_block_ids, ["ursachen", "ablauf"], "a reworded and a new Abschnitt");
  assert.deepEqual(geo.removed_sections, ["Termin vereinbaren"], "an Abschnitt the step dropped is named");
  assert.equal(geo.words_delta, geo.words - seo.words);
  console.log("text and changes against the step before: ok");
}

{
  // Watermark Entfernung keeps only the rewritten bodies: its text is the text before it with those swapped in.
  const watermark = contentStepText(steps, CONTENT_STEP_WATERMARK)!;
  assert.equal(watermark.compared_to, "GEO", "the last step before it that holds a text");
  assert.deepEqual(watermark.changed_block_ids, ["ursachen"]);
  assert.match(watermark.html, /zu wenig Schlaf/);
  assert.match(watermark.html, /Wie läuft die Diagnostik ab\?/, "headings come from the text before");
  assert.equal(contentStepText([steps[0]!, row(CONTENT_STEP_WATERMARK, "done", { rewritten: { a: "<p>x</p>" } })], CONTENT_STEP_WATERMARK), null, "no text before it: nothing to show");
  assert.equal(contentStepText(steps, 99), null);
  console.log("watermark: ok");
}

{
  const list = stepList(steps, { source: "structure", source_url: null, skip_steps: [] });
  const seo = list.find((s) => s.step === CONTENT_STEP_SEO)!;
  assert.deepEqual([seo.input_tokens, seo.output_tokens, seo.cost_eur, seo.has_text], [48_210, 6_412, 0.24, true]);
  assert.equal(list.find((s) => s.step === CONTENT_STEP_ANALYSE)!.has_text, false);
  assert.equal(list.find((s) => s.step === CONTENT_STEP_HORMOZI)!.input_tokens, 0, "a step that has not run shows no tokens");
  assert.equal(contentStepLogLine(seo), "48.210 Eingabe-Tokens · 6.412 Ausgabe-Tokens · vollständig (tool_use)");
  assert.equal(contentStepLogLine({ output_tokens: 0, stop_reason: null }), "");
  console.log("step list: tokens, cost, has_text: ok");
}

console.log("OK: content step text tests passed");
