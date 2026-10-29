/**
 * Texte: steps switched off per page („Schritte“ in the page window, `skip_steps`). Which
 * steps may be switched off, the runner marking them „skipped“ without a model call, the
 * step-specific rules (SEO takes the live text, Hormozi drops the empty hero, GEO off means no
 * send-back, Watermark progress is dropped), the rerun refusal, the PATCH validation, and
 * that reset, upload and crawl import keep the list. In-memory database and fetch; no network.
 * Run: npm run test:content-skip-steps
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EMPTY_CONTENT_FRESHNESS, freshnessSendBackLine, reviewFreshness } from "../lib/dt/content/freshness";
import { describeRunningPage } from "../lib/dt/content/job-state";
import { parseContentPagePatch } from "../lib/dt/content/page-patch";
import { rerunContentStep, resetContentPage } from "../lib/dt/content/pipeline/actions";
import { unchangedAktualitaetOutput, aktualitaetResearchPrompt, aktualitaetWriteSpec } from "../lib/dt/content/pipeline/aktualitaet";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import {
  CONTENT_HERO_PLACEHOLDER,
  CONTENT_HERO_PLACEHOLDER_LEGACY,
  contentStepSpec,
  isEmptyHeroPlaceholder,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import { skipContentStep, type StepOutcome } from "../lib/dt/content/pipeline/run-step";
import {
  LIVE_TEXT_FAILURE_PREFIX,
  planFreshness,
  skippedStepPatch,
  stepPatchFor,
  type LiveTextImport,
} from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_SKIPPABLE_STEP_KEYS,
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_WATERMARK,
  CONTENT_STEPS,
  contentStepByKey,
  contentStepDefinition,
  contentStepSkippable,
  contentStepSkippedByUser,
  nextContentStep,
  normalizeSkipSteps,
  runningPageDetail,
  skipsContentStep,
  upcomingContentStep,
} from "../lib/dt/content/pipeline/steps";
import { contentSkipWarnings, contentStepStatusLabel } from "../lib/dt/content/presentation";
import { parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import {
  CONTENT_SKIP_STEPS_MIGRATION_FILE,
  CONTENT_SKIPPED_RERUN_MESSAGE,
  PAGE_COLUMNS,
  applyContentBriefingUpdates,
  buildReview,
  contentDbErrorMessage,
  pageActions,
  pageSummary,
  planContentSkipSteps,
  syncContentPagesFromCrawl,
  upsertContentPagesFromBriefing,
  type ContentPageRow,
  type ContentStepRow,
} from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentFinding } from "../lib/dt/content/types";
import { runContentPageSteps } from "../lib/jobs/handlers/content-page";

import { FakeDb, type FakeRow } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_URL = "https://praxis.de/implantate";

// --- the in-memory database, with this page's rows at hand -----------------------------------

type Row = FakeRow;

class FakeContentDb extends FakeDb {
  page(): Row {
    return this.rows("dt_content_pages").find((p) => p.id === PAGE_ID)!;
  }
  step(step: number): Row | undefined {
    return this.rows("dt_content_steps").find((s) => s.page_id === PAGE_ID && s.step === step);
  }
}

// --- fixtures -----------------------------------------------------------------------------------

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID,
  organisation_id: ORG,
  slug: "implantate",
  name: "Implantate",
  path: "/implantate",
  level: 1,
  position: 0,
  source: "crawl",
  source_url: LIVE_URL,
  crawled_at: "2026-10-20T10:00:00Z",
  main_keyword: null,
  page_role: null,
  page_type: "unterseite",
  pillar_name: null,
  estimated_traffic: null,
  keywords: null,
  h1_options: [],
  user_questions: [],
  ki_prompt: null,
  internal_link_targets: [],
  state: "laeuft",
  step: null,
  released: false,
  released_at: null,
  title: null,
  meta_description: null,
  html: "",
  markdown: "",
  findings: [],
  final_findings: [],
  unresolved: [],
  questions: [],
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  skip_steps: [],
  error: null,
  job_id: JOB_ID,
  cost_eur: 0,
  started_by: null,
  created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:00:00Z",
  ...patch,
});

const stepRow = (step: number, patch: Partial<ContentStepRow> = {}): ContentStepRow => ({
  id: `s${step}`,
  page_id: PAGE_ID,
  organisation_id: ORG,
  step,
  name: contentStepDefinition(step)!.name,
  status: "done",
  output: { stub: step },
  model: "claude-stub",
  input_tokens: 100,
  output_tokens: 50,
  cost_eur: 0.01,
  error: null,
  started_at: "2026-10-27T09:00:00Z",
  finished_at: "2026-10-27T09:01:00Z",
  approved_by: null,
  approved_at: null,
  ...patch,
});

const LIVE_HTML = `<html><head><title>Implantate | Praxis Dr. Berg</title><meta name="description" content="Feste Zähne in Krefeld."></head><body><header>Logo</header><main><h1>Implantate in Krefeld</h1><p>Feste Zähne an einem Tag.</p><h2>Ablauf</h2><p>Drei Termine.</p></main><footer>Impressum</footer></body></html>`;
const SITE_ROW = { organisation_id: ORG, url: LIVE_URL, title: "Implantate | Praxis Dr. Berg", h1: "Implantate in Krefeld", text_content: "Implantate in Krefeld\nFeste Zähne an einem Tag.", is_excluded: false };
const liveFetch = async () => new Response(LIVE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const deadFetch = async () => {
  throw new Error("ECONNRESET");
};

const textBlocks = (hero: ContentTextBlock | null): ContentTextBlock[] => [
  { id: "intro", heading: "Implantate in Krefeld", level: 1, html: "<p>Feste Zähne.</p>" },
  ...(hero ? [hero] : []),
  { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>Drei Termine.</p>" },
];
const placeholderHero: ContentTextBlock = { id: "hero", heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" };

/** Records every step the runner hands to the model; the real step would bill and save. */
function stubRunner(db: FakeContentDb, calls: number[]) {
  return async (_service: unknown, page: ContentPageRow, _steps: readonly ContentStepRow[], step: number): Promise<StepOutcome> => {
    calls.push(step);
    const existing = db.step(step);
    const row = stepRow(step, { status: step === CONTENT_STEP_ENDABNAHME ? "waiting" : "done" });
    if (existing) Object.assign(existing, row);
    else db.rows("dt_content_steps").push(row);
    Object.assign(db.page(), { step, ...(step === CONTENT_STEP_ENDABNAHME ? { state: "fertig", job_id: null } : {}) });
    return { step, halted: step === CONTENT_STEP_ENDABNAHME, model: "claude-stub", costEur: 0.01 };
  };
}

const job = { id: JOB_ID, attempts: 0, max_attempts: 3 };
const skipWith = (fetchImpl: typeof liveFetch | typeof deadFetch) => (
  service: SupabaseClient,
  page: ContentPageRow,
  steps: readonly ContentStepRow[],
  step: number,
) => skipContentStep(service, page, steps, step, { fetchImpl: fetchImpl as never });

// --- 1. which steps can be switched off ---------------------------------------------------------

{
  const crawl = { source: "crawl", source_url: LIVE_URL };
  const structure = { source: "structure", source_url: null };
  assert.deepEqual(CONTENT_STEPS.map((s) => s.key), [
    "analyse", "seo", "faktencheck", "geo", "aktualitaet", "hormozi", "vermenschlichung", "lektorat", "watermark", "endabnahme",
  ]);
  for (const def of CONTENT_STEPS) assert.equal(contentStepByKey(def.key)?.step, def.step, `${def.key} by key`);
  assert.equal(contentStepByKey("recherche"), null);

  for (const key of ["analyse", "endabnahme"]) {
    const check = contentStepSkippable(crawl, key);
    assert.ok(!check.ok && /^Läuft immer/.test(check.reason), `${key} always runs`);
    assert.ok(!(CONTENT_SKIPPABLE_STEP_KEYS as readonly string[]).includes(key));
  }
  assert.deepEqual(contentStepSkippable(crawl, "seo"), { ok: true, reason: null }, "SEO on a crawl page");
  const seoStructure = contentStepSkippable(structure, "seo");
  assert.ok(!seoStructure.ok && seoStructure.reason === "Nur bei Seiten von der Website: dann wird der aktuelle Live-Text übernommen");
  assert.ok(!contentStepSkippable({ source: "crawl", source_url: null }, "seo").ok, "a crawl row without live URL has no live text");
  assert.ok(!contentStepSkippable({ source: "structure", source_url: LIVE_URL }, "seo").ok, "a structure page with an attached URL is no crawl page");
  for (const key of ["faktencheck", "geo", "aktualitaet", "hormozi", "vermenschlichung", "lektorat", "watermark"]) {
    assert.ok(contentStepSkippable(structure, key).ok, `${key} on any page`);
  }
  assert.ok(!contentStepSkippable(crawl, "nix").ok);

  assert.deepEqual(normalizeSkipSteps(["watermark", "seo", "seo", "analyse", "nix", 3, null]), ["seo", "watermark"], "known keys, once, in step order");
  assert.deepEqual(normalizeSkipSteps(null), []);
  assert.equal(contentStepSkippedByUser(["geo"], CONTENT_STEP_GEO), true);
  assert.equal(contentStepSkippedByUser(["geo"], CONTENT_STEP_SEO), false);
  assert.equal(contentStepSkippedByUser(["analyse"], 1), false, "a stray analyse key never skips the Analyse");

  // The runner acts on rows that still have to run, never on done, waiting, running or skipped ones.
  assert.equal(skipsContentStep(["geo"], CONTENT_STEP_GEO, undefined), true, "no row yet");
  assert.equal(skipsContentStep(["geo"], CONTENT_STEP_GEO, { status: "pending" }), true);
  assert.equal(skipsContentStep(["geo"], CONTENT_STEP_GEO, { status: "error" }), true, "an error row the editor switched off afterwards");
  for (const status of ["done", "waiting", "running", "skipped"]) {
    assert.equal(skipsContentStep(["geo"], CONTENT_STEP_GEO, { status }), false, `a ${status} row stays`);
  }
  assert.equal(skipsContentStep([], CONTENT_STEP_GEO, undefined), false);
}
console.log("skippable steps: ok");

// --- 2. the migration -----------------------------------------------------------------------------

{
  const sql = readFileSync(CONTENT_SKIP_STEPS_MIGRATION_FILE, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS skip_steps text\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS dt_content_pages_skip_steps_check/, "idempotent: the CHECK is replaced, not added twice");
  const keys = sql.match(/skip_steps <@ ARRAY\[([^\]]+)\]::text\[\]/)?.[1]?.split(",").map((k) => k.trim().replace(/'/g, ""));
  assert.deepEqual(keys, [...CONTENT_SKIPPABLE_STEP_KEYS], "the CHECK allows exactly the keys the code offers");
  assert.match(sql, /COMMENT ON COLUMN public\.dt_content_pages\.skip_steps/);
  assert.match(PAGE_COLUMNS, /\bskip_steps\b/, "every page read needs the column");

  const missing = contentDbErrorMessage({ code: "42703", message: "column dt_content_pages.skip_steps does not exist" }, "x");
  assert.ok(missing.includes(CONTENT_SKIP_STEPS_MIGRATION_FILE) && /Supabase SQL Editor/.test(missing), "a missing column names the migration");
  const write = contentDbErrorMessage({ code: "PGRST204", message: "Could not find the 'skip_steps' column of 'dt_content_pages' in the schema cache" }, "x");
  assert.ok(write.includes(CONTENT_SKIP_STEPS_MIGRATION_FILE));
  const check = contentDbErrorMessage({ code: "23514", message: 'new row for relation "dt_content_pages" violates check constraint "dt_content_pages_skip_steps_check"' }, "x");
  assert.ok(check.includes(CONTENT_SKIP_STEPS_MIGRATION_FILE) && !check.includes("20261027"));
}
console.log("migration: ok");

// --- 3. the progress line -------------------------------------------------------------------------

{
  const done = (n: number) => Array.from({ length: n }, (_, i) => ({ step: i + 1, status: "done" }));
  assert.equal(nextContentStep([...done(4), { step: 5, status: "skipped" }]), CONTENT_STEP_HORMOZI, "a skipped row is passed");
  assert.equal(nextContentStep(done(4)), CONTENT_STEP_AKTUALITAET, "nextContentStep still reaches a step to skip: the runner marks it");
  assert.equal(upcomingContentStep(done(4), ["aktualitaet", "hormozi"]), 7, "the next step that will really run");
  assert.equal(upcomingContentStep(done(4), []), CONTENT_STEP_AKTUALITAET);
  assert.equal(runningPageDetail(4, done(4)), "Schritt 5 von 10 startet: Aktualitätsprüfung");
  assert.equal(runningPageDetail(4, done(4), ["aktualitaet"]), "Schritt 6 von 10 startet: Hormozi", "a switched-off step is not announced");
  assert.equal(runningPageDetail(5, [...done(4), { step: 5, status: "skipped" }], ["aktualitaet"]), "Schritt 6 von 10 startet: Hormozi");
  assert.equal(runningPageDetail(6, [...done(5), { step: 6, status: "running" }], ["aktualitaet"]), "Schritt 6 von 10: Hormozi läuft");
  assert.equal(
    describeRunningPage({ step: 4, error: null, skip_steps: ["aktualitaet"] }, done(4), { kind: "queued", waitMs: 1_000, error: null }),
    "Schritt 6 von 10: Hormozi startet gleich",
  );
}
console.log("progress line: ok");

// --- 4. the runner: skipped steps cost nothing and the loop goes on ------------------------------

async function runnerTests() {
  {
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ skip_steps: ["seo", "geo", "hormozi", "watermark"] })], dt_site_pages: [SITE_ROW] });
    const calls: number[] = [];
    const result = await runContentPageSteps({
      service: db.service,
      job,
      pageId: PAGE_ID,
      deadline: Date.now() + 240_000,
      runners: { runStep: stubRunner(db, calls), skipStep: skipWith(liveFetch) },
    });
    assert.deepEqual(calls, [1, 3, 5, 7, 8, 10], "the model runs only for steps that are on");
    assert.equal(result.ok && result.result?.halted, true, "the Endabnahme halts as always");
    for (const step of [CONTENT_STEP_SEO, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_WATERMARK]) {
      const row = db.step(step)!;
      assert.equal(row.status, "skipped", `step ${step} skipped`);
      assert.equal(row.name, contentStepDefinition(step)!.name);
      assert.deepEqual([row.model, row.input_tokens, row.output_tokens, row.cost_eur, row.error], [null, 0, 0, 0, null], `step ${step}: no model, 0 €`);
      assert.ok(typeof row.started_at === "string" && row.started_at === row.finished_at);
      assert.equal((row.output as { skipped_by?: string }).skipped_by, "user");
    }
    assert.deepEqual(db.step(CONTENT_STEP_GEO)!.output, { skipped_by: "user" });
    assert.equal(db.rows("dt_llm_usage_events").length, 0, "no usage event for a skip");
    assert.equal(db.page().state, "fertig");
    const html = String(db.page().html);
    assert.match(html, /Implantate in Krefeld/, "the live text is the page text");
    assert.doesNotMatch(html, /\[HERO/, "Hormozi is off too: no hero placeholder");
  }

  {
    // Little time left: skips still happen at once; the next real step waits for the next tick.
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ step: 2, skip_steps: ["faktencheck", "geo"] })],
      dt_content_steps: [stepRow(1), stepRow(2)],
    });
    const calls: number[] = [];
    const result = await runContentPageSteps({
      service: db.service,
      job,
      pageId: PAGE_ID,
      deadline: Date.now() + 5_000,
      runners: { runStep: stubRunner(db, calls) },
    });
    assert.deepEqual(calls, [], "no budget for a model step");
    assert.equal(db.step(CONTENT_STEP_FAKTENCHECK)!.status, "skipped");
    assert.equal(db.step(CONTENT_STEP_GEO)!.status, "skipped");
    assert.equal(db.page().step, CONTENT_STEP_GEO, "the page moved on to the last skipped step");
    assert.equal(db.page().state, "laeuft");
    assert.ok(result.ok && result.reschedule, "rescheduled for the Aktualitätsprüfung");
    assert.equal(db.step(CONTENT_STEP_AKTUALITAET), undefined, "the next real step did not start");
    assert.equal(runningPageDetail(Number(db.page().step), db.rows("dt_content_steps") as never, ["faktencheck", "geo"]), "Schritt 5 von 10 startet: Aktualitätsprüfung");
  }

  {
    // Done rows and the Aktualitätsprüfung the migration 20261027 skipped stay as they are.
    const migrated = stepRow(CONTENT_STEP_AKTUALITAET, { status: "skipped", output: null, model: null, cost_eur: 0, started_at: null, finished_at: null });
    const doneCheck = stepRow(CONTENT_STEP_FAKTENCHECK, { output: { findings: [], questions: [] } });
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ step: 5, skip_steps: ["faktencheck", "aktualitaet", "hormozi"] })],
      dt_content_steps: [stepRow(1), stepRow(2), doneCheck, stepRow(4), migrated],
    });
    const calls: number[] = [];
    await runContentPageSteps({ service: db.service, job, pageId: PAGE_ID, deadline: Date.now() + 5_000, runners: { runStep: stubRunner(db, calls) } });
    assert.deepEqual(db.step(CONTENT_STEP_FAKTENCHECK), doneCheck, "a done row is never touched by the list");
    assert.deepEqual(db.step(CONTENT_STEP_AKTUALITAET), migrated, "the migration's skipped row stays (no skipped_by)");
    assert.equal(db.step(CONTENT_STEP_HORMOZI)!.status, "skipped", "the first step still to run is skipped");
  }

  {
    // An error row the editor switched off before „Weiterlaufen lassen“: skipped, not retried.
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ step: 3, skip_steps: ["faktencheck"] })],
      dt_content_steps: [stepRow(1), stepRow(2), stepRow(3, { status: "pending", error: "Überlastet", output: null, cost_eur: 0 })],
    });
    await runContentPageSteps({ service: db.service, job, pageId: PAGE_ID, deadline: Date.now() + 5_000, runners: { runStep: stubRunner(db, []) } });
    assert.deepEqual([db.step(3)!.status, db.step(3)!.error], ["skipped", null]);
    assert.equal(db.page().error, null, "the old error leaves the page");
  }

  {
    // Watermark progress of an earlier attempt: dropped; the text stays as before the step; what it cost stays counted.
    const html = renderBlocksHtml(textBlocks(null));
    const progress = { chunks_done: 1, chunks: 3, blocks: [{ id: "intro", heading: "Umformuliert", level: 1, html: "<p>x</p>" }] };
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ step: 9, html, cost_eur: 1, skip_steps: ["watermark"] })],
      dt_content_steps: [...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => stepRow(n)), stepRow(9, { status: "pending", output: progress, cost_eur: 0.12, model: "grok-4" })],
    });
    await runContentPageSteps({ service: db.service, job, pageId: PAGE_ID, deadline: Date.now() + 5_000, runners: { runStep: stubRunner(db, []) } });
    assert.deepEqual(db.step(9)!.output, { skipped_by: "user" }, "the saved chunks are gone");
    assert.deepEqual([db.step(9)!.cost_eur, db.step(9)!.model], [0, null]);
    assert.equal(db.page().html, html, "the text is the one from before the Watermark step");
    assert.equal(db.page().cost_eur, 1.12, "the chunks already paid stay in the page total");
  }

  {
    // Stopped or reset while the loop ran: nothing is written.
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ state: "in_arbeit", skip_steps: ["geo"] })] });
    const outcome = await skipContentStep(db.service, pageRow({ skip_steps: ["geo"] }), [], CONTENT_STEP_GEO);
    assert.deepEqual([outcome.halted, outcome.discarded], [true, true]);
    assert.equal(db.step(CONTENT_STEP_GEO), undefined);
    assert.equal(db.page().step, null);
  }
  console.log("runner: ok");
}

// --- 5. SEO off: the live text becomes the starting text ------------------------------------------

async function seoTests() {
  const steps = [stepRow(1)];
  {
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ step: 1, skip_steps: ["seo"] })], dt_site_pages: [SITE_ROW] });
    const outcome = await skipContentStep(db.service, pageRow({ step: 1, skip_steps: ["seo"] }), steps, CONTENT_STEP_SEO, { fetchImpl: liveFetch as never });
    assert.deepEqual([outcome.halted, outcome.skipped], [false, true]);
    const row = db.step(CONTENT_STEP_SEO)!;
    assert.deepEqual(row.output, { skipped_by: "user", live_text: true, source: "live", url: LIVE_URL });
    assert.equal(row.status, "skipped");
    const page = db.page();
    const blocks = parseBlocksFromHtml(String(page.html));
    assert.deepEqual(blocks.map((b) => [b.heading, b.level]), [["Implantate in Krefeld", 1], [CONTENT_HERO_PLACEHOLDER, 2], ["Ablauf", 2]], "H1, the empty hero, the live sections");
    assert.doesNotMatch(String(page.html), /Logo|Impressum/);
    assert.match(String(page.markdown), /# Implantate in Krefeld/);
    assert.equal(page.title, "Implantate | Praxis Dr. Berg");
    assert.equal(page.meta_description, "Feste Zähne in Krefeld.");
    assert.deepEqual(page.questions, [], "the placeholder check ran: nothing open");
    assert.equal(page.step, CONTENT_STEP_SEO);
    const review = buildReview(pageRow({ ...(page as Partial<ContentPageRow>), skip_steps: ["seo"] }), db.rows("dt_content_steps") as ContentStepRow[]);
    const seo = review.steps.find((s) => s.key === "seo")!;
    assert.deepEqual([seo.live_text, seo.skipped_by_user, seo.cost_eur], [true, true, 0]);
    assert.equal(contentStepStatusLabel(seo.status, { liveText: seo.live_text }), "Übersprungen – Live-Text übernommen");
  }
  {
    // Hormozi off too: nobody would fill a hero, so none is added.
    const both = pageRow({ step: 1, skip_steps: ["seo", "hormozi"] });
    const db = new FakeContentDb({ dt_content_pages: [both], dt_site_pages: [SITE_ROW] });
    await skipContentStep(db.service, both, steps, CONTENT_STEP_SEO, { fetchImpl: liveFetch as never });
    assert.deepEqual(parseBlocksFromHtml(String(db.page().html)).map((b) => b.heading), ["Implantate in Krefeld", "Ablauf"]);
  }
  {
    // Live page down: the stored crawl text.
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ step: 1, skip_steps: ["seo"] })], dt_site_pages: [SITE_ROW] });
    await skipContentStep(db.service, pageRow({ step: 1, skip_steps: ["seo"] }), steps, CONTENT_STEP_SEO, { fetchImpl: deadFetch as never });
    assert.deepEqual(db.step(CONTENT_STEP_SEO)!.output, { skipped_by: "user", live_text: true, source: "crawl", url: LIVE_URL });
    assert.match(String(db.page().html), /Feste Zähne an einem Tag/);
    assert.equal(db.page().title, null, "the crawl text has no <title>: the page keeps its own");
  }
  {
    // A placeholder in the live text stops the page like after any text step; the row stays „skipped“.
    const withGap = SITE_ROW.text_content + "\nPreis: [BITTE PRÜFEN: Preis pro Implantat]";
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ step: 1, skip_steps: ["seo"] })], dt_site_pages: [{ ...SITE_ROW, text_content: withGap }] });
    const outcome = await skipContentStep(db.service, pageRow({ step: 1, skip_steps: ["seo"] }), steps, CONTENT_STEP_SEO, { fetchImpl: deadFetch as never });
    assert.equal(outcome.halted, true);
    assert.equal(db.page().state, "braucht_sie");
    assert.equal((db.page().questions as unknown[]).length, 1);
    assert.equal(db.step(CONTENT_STEP_SEO)!.status, "skipped");
  }
  {
    // Neither live HTML nor crawl text: the page pauses with the reason, never an empty text.
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ step: 1, skip_steps: ["seo"] })],
      dt_content_steps: [stepRow(1)],
      dt_site_pages: [{ ...SITE_ROW, text_content: "", h1: null, title: null }],
    });
    const calls: number[] = [];
    const result = await runContentPageSteps({
      service: db.service,
      job,
      pageId: PAGE_ID,
      deadline: Date.now() + 240_000,
      runners: { runStep: stubRunner(db, calls), skipStep: skipWith(deadFetch) },
    });
    assert.deepEqual(calls, [], "nothing after the failed import runs");
    assert.ok(!result.ok && result.retryable === false);
    assert.equal(db.page().state, "in_arbeit", "the page pauses");
    assert.ok(String(db.page().error).startsWith(`${LIVE_TEXT_FAILURE_PREFIX}:`), "with the German reason");
    assert.match(String(db.page().error), /Bitte SEO wieder einschalten oder erneut crawlen\.$/);
    assert.equal(db.step(CONTENT_STEP_SEO)!.status, "error");
    assert.equal(db.page().html, "", "no empty text was saved");
  }
  {
    // The page left the crawl (no live URL): an error with the reason, no fetch.
    const db = new FakeContentDb({ dt_content_pages: [pageRow({ source: "structure", source_url: null, skip_steps: ["seo"] })] });
    await assert.rejects(
      skipContentStep(db.service, pageRow({ source: "structure", source_url: null, skip_steps: ["seo"] }), [], CONTENT_STEP_SEO, { fetchImpl: liveFetch as never }),
      (error: unknown) => error instanceof ContentLlmError && !error.retryable && error.message.startsWith(LIVE_TEXT_FAILURE_PREFIX),
    );
  }
  {
    // Pure: SEO without an import, or with an empty one, is an error.
    const seo = contentStepDefinition(CONTENT_STEP_SEO)!;
    const page = pageRow({ skip_steps: ["seo"] });
    assert.throws(() => skippedStepPatch(seo, page), (e: unknown) => e instanceof ContentLlmError && e.message.startsWith(LIVE_TEXT_FAILURE_PREFIX));
    const empty: LiveTextImport = { source: "crawl", url: LIVE_URL, ingested: { blocks: [], title: null, metaDescription: null } };
    assert.throws(() => skippedStepPatch(seo, page, { live: empty }), /keinen Text/);
  }
  console.log("SEO live text: ok");
}

// --- 6. Hormozi off: the empty hero goes ----------------------------------------------------------

{
  const hormozi = contentStepDefinition(CONTENT_STEP_HORMOZI)!;
  const patch = (hero: ContentTextBlock | null) => skippedStepPatch(hormozi, pageRow({ html: renderBlocksHtml(textBlocks(hero)), skip_steps: ["hormozi"] }));
  for (const hero of [
    placeholderHero,
    { ...placeholderHero, heading: CONTENT_HERO_PLACEHOLDER_LEGACY },
    { id: "hero", heading: null, level: 2 as const, html: `<p>${CONTENT_HERO_PLACEHOLDER}</p>` },
  ]) {
    const out = patch(hero);
    assert.equal(out.stepRow.output.hero_removed, true, `removed: ${hero.heading ?? hero.html}`);
    assert.deepEqual(parseBlocksFromHtml(String(out.pagePatch.html)).map((b) => b.id), ["intro", "ablauf"]);
    assert.doesNotMatch(String(out.pagePatch.markdown), /HERO/);
  }
  for (const hero of [
    { id: "hero", heading: null, level: 2 as const, html: "<p><strong>Feste Zähne an einem Tag.</strong></p>" },
    { ...placeholderHero, html: "<p>Ein Satz, den die Redaktion schon geschrieben hat.</p>" },
  ]) {
    const out = patch(hero);
    assert.equal(out.pagePatch.html, undefined, "a hero with content stays");
    assert.deepEqual(out.stepRow.output, { skipped_by: "user" });
  }
  assert.equal(patch(null).pagePatch.html, undefined, "no hero, nothing to do");
  assert.equal(isEmptyHeroPlaceholder(placeholderHero), true);
  assert.equal(isEmptyHeroPlaceholder({ ...placeholderHero, heading: "Feste Zähne" }), false);
}
console.log("Hormozi hero: ok");

// --- 7. GEO off: the Aktualitätsprüfung does not send back ----------------------------------------

const finding = (title: string): ContentFinding => ({ title, problem: `${title}: Problem`, proposal: "", severity: "medium", severity_label: "Mittel", block_id: null });

const context = (extra: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Dr. Berg",
  page: {
    name: "Implantate",
    path: "/implantate",
    level: 1,
    url: LIVE_URL,
    source: "crawl",
    page_role: null,
    page_type: "unterseite",
    pillar_name: null,
    estimated_traffic: null,
    keywords: null,
    h1_options: [],
    user_questions: [],
    ki_prompt: null,
    internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "unternehmen", label: "Unternehmen", current: "Praxis Dr. Berg in Krefeld." }],
  settings: { anrede: "Sie", branche: "Zahnarzt", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: { 1: { main_keyword: "Implantate Krefeld" } },
  blocks: textBlocks(placeholderHero),
  title: "Implantate",
  metaDescription: null,
  ...extra,
});

{
  const def = contentStepDefinition(CONTENT_STEP_AKTUALITAET)!;
  const research = { sources: [{ url: "https://www.bzaek.de/", title: "BZÄK" }], searches: 1, fetches: 0, claims: 1, search_limit_hit: false };
  const section = { block_id: "ablauf", section: "Ablauf", problem: "Neue Leitlinie", suggestion: "Ablauf anpassen", sources: research.sources };
  const out = { ...unchangedAktualitaetOutput(context(), research), outdated_sections: [section], findings: [finding("Abgelehnte Änderung")] };
  const fk = finding("Preis unbelegt");
  const html = renderBlocksHtml(textBlocks(placeholderHero));

  const normal = stepPatchFor(def, out, { html, freshness: {}, findings: [], skip_steps: [] });
  assert.equal(normal.resetFrom, CONTENT_STEP_GEO, "with GEO on, the text goes back once");

  const off = stepPatchFor(def, out, {
    html,
    freshness: {},
    findings: [fk, finding("Alter Punkt einer früheren Prüfung")],
    skip_steps: ["geo"],
    faktencheck_findings: [fk, finding("Schon bearbeitet")],
  });
  assert.equal(off.resetFrom, undefined, "GEO off: no send-back, no second paid check");
  assert.equal(off.halted, false);
  const freshness = off.pagePatch.freshness as typeof EMPTY_CONTENT_FRESHNESS;
  assert.deepEqual([freshness.sendbacks, freshness.pending_sections, freshness.converted_sections], [0, [], [section]], "converted at once, as on a second pass");
  const titles = (off.pagePatch.findings as ContentFinding[]).map((f) => f.title);
  assert.deepEqual(titles, ["Preis unbelegt", "Abgelehnte Änderung", "Abschnitt veraltet: Ablauf"], "Faktencheck findings still on the page stay, the check's own follow");
  assert.equal(freshnessSendBackLine(reviewFreshness(freshness)), "Nicht an GEO zurückgegeben (GEO ist abgeschaltet): 1 veralteter Abschnitt steht unter „Offene Punkte“.");

  const planned = planFreshness(EMPTY_CONTENT_FRESHNESS, out, "2026-10-27T10:00:00Z", { geoSkipped: true });
  assert.equal(planned.sendBack, false);
  assert.equal(planFreshness(EMPTY_CONTENT_FRESHNESS, out, "2026-10-27T10:00:00Z").sendBack, true);

  // Without GEO's (and the Faktencheck's) output the prompts still build cleanly.
  const noGeo = context({ outputs: { 1: { main_keyword: "Implantate Krefeld" }, 3: { findings: [], questions: [] } } });
  const prompts = [
    aktualitaetResearchPrompt(noGeo).user,
    aktualitaetWriteSpec(noGeo, { ...research, text: "Protokoll" }).user,
    contentStepSpec(CONTENT_STEP_HORMOZI, noGeo).user,
  ];
  for (const user of prompts) assert.doesNotMatch(user, /undefined|\[object Object\]/);
}
console.log("GEO off / Aktualitätsprüfung: ok");

// --- 8. Faktencheck off: GEO and Endabnahme without its output -----------------------------------

{
  const noCheck = context({ outputs: { 1: { main_keyword: "Implantate Krefeld" } } });
  const geo = contentStepSpec(CONTENT_STEP_GEO, noCheck).user;
  assert.doesNotMatch(geo, /Faktencheck \(Schritt 3\)/, "no empty Faktencheck block");
  assert.doesNotMatch(geo, /undefined/);
  // GEO off keeps the Faktencheck's findings open: the Endabnahme must have room to carry them.
  // A real page (Allround, Lastenradträger) had 13 of them plus 8 from the Lektorat; 3,000 tokens cut it off.
  const carried = Array.from({ length: 30 }, (_, i) => ({
    ...finding(`Befund ${i + 1}: Lieferzeit im Text weicht von den Anbieterfakten ab`),
    problem: "Der Text nennt 2–3 Wochen außerhalb der Saison und 6–12 Wochen in der Saison; die Anbieterfakten nennen 1–4 Wochen (Standard) und 6–8 Wochen (Sonderanfertigungen).",
    proposal: "Die Angaben aus den Anbieterfakten übernehmen oder den Kunden fragen, welche Werte gelten.",
  }));
  const budget = contentStepSpec(CONTENT_STEP_ENDABNAHME, context({ openFindings: carried })).maxTokens;
  assert.ok(budget >= (JSON.stringify(carried).length / 3) * 1.2, `30 carried findings fit the Endabnahme's ${budget} tokens`);
  const endabnahme = contentStepSpec(CONTENT_STEP_ENDABNAHME, context({ outputs: {} })).user;
  assert.doesNotMatch(endabnahme, /undefined|Lektorat \(Schritt/, "Lektorat off too: its block is left out");
  assert.match(contentStepSpec(CONTENT_STEP_GEO, context({ outputs: { 3: { findings: [finding("x")], questions: [] } } })).user, /Faktencheck \(Schritt 3\)/, "with its output the block is there");

  // Every other skipped step: the row only, the text untouched.
  for (const key of ["faktencheck", "geo", "aktualitaet", "vermenschlichung", "lektorat", "watermark"]) {
    const def = contentStepByKey(key)!;
    const out = skippedStepPatch(def, pageRow({ html: "<section data-block-id=\"a\"><h1>A</h1></section>", freshness: { ...EMPTY_CONTENT_FRESHNESS, sendbacks: 1 } }));
    assert.deepEqual(out.pagePatch, { step: def.step, error: null }, `${key}: page text, findings and freshness untouched`);
    assert.equal(out.halted, false);
  }
}
console.log("Faktencheck off and the others: ok");

// --- 9. rerun, actions, review, summary, warnings --------------------------------------------------

async function actionTests() {
  const db = new FakeContentDb({ dt_content_pages: [pageRow({ state: "in_arbeit", step: CONTENT_STEP_HORMOZI, skip_steps: ["hormozi"] })] });
  const page = pageRow({ state: "in_arbeit", step: CONTENT_STEP_HORMOZI, html: "<p>x</p>", skip_steps: ["hormozi"] });
  const refused = await rerunContentStep(db.service, page, CONTENT_STEP_HORMOZI, "Kürzer bitte", "u1");
  assert.deepEqual(refused, { ok: false, status: 409, message: CONTENT_SKIPPED_RERUN_MESSAGE });
  assert.equal(CONTENT_SKIPPED_RERUN_MESSAGE, "Schritt ist für diese Seite abgeschaltet – erst wieder einschalten.");
  assert.equal(db.log.length, 0, "nothing was reset");

  const rerun = pageActions(page).find((a) => a.kind === "rerun_with_note")!;
  assert.deepEqual([rerun.step, rerun.disabled_reason], [CONTENT_STEP_HORMOZI, CONTENT_SKIPPED_RERUN_MESSAGE], "the drawer disables it with the reason");
  assert.equal(pageActions({ ...page, skip_steps: [] }).find((a) => a.kind === "rerun_with_note")!.disabled_reason, undefined);
  const fertig = pageActions({ ...page, state: "fertig", step: CONTENT_STEP_ENDABNAHME, skip_steps: ["lektorat"] }).find((a) => a.kind === "rerun_with_note")!;
  assert.equal(fertig.step === CONTENT_STEP_LEKTORAT && Boolean(fertig.disabled_reason), true);

  const review = buildReview(pageRow({ source: "structure", source_url: null, state: "nicht_begonnen", skip_steps: ["geo"] }), [
    stepRow(CONTENT_STEP_AKTUALITAET, { status: "skipped", output: null }),
  ]);
  assert.deepEqual(review.skip_steps, ["geo"]);
  const by = (key: string) => review.steps.find((s) => s.key === key)!;
  assert.deepEqual([by("analyse").skippable, by("analyse").reason_locked?.startsWith("Läuft immer")], [false, true]);
  assert.deepEqual([by("endabnahme").skippable, by("endabnahme").skipped_by_user], [false, false]);
  assert.deepEqual([by("seo").skippable, by("seo").reason_locked], [false, "Nur bei Seiten von der Website: dann wird der aktuelle Live-Text übernommen"]);
  assert.deepEqual([by("geo").skippable, by("geo").skipped_by_user], [true, true]);
  assert.deepEqual([by("aktualitaet").status, by("aktualitaet").skipped_by_user, by("aktualitaet").live_text], ["skipped", false, false], "a migration-skipped row is no user choice");
  assert.deepEqual(Object.keys(by("geo")).sort(), ["cost_eur", "exists", "key", "live_text", "name", "reason_locked", "skippable", "skipped_by_user", "status", "step"]);

  assert.equal(pageSummary(pageRow({ skip_steps: ["geo", "watermark"] })).skipped_count, 2);
  assert.equal(pageSummary(pageRow()).skipped_count, 0);

  assert.deepEqual(contentSkipWarnings(["seo", "faktencheck"]), ["Ohne Faktencheck werden Aussagen aus dem Live-Text nicht gegen die Anbieterfakten geprüft."]);
  assert.deepEqual(contentSkipWarnings(["geo"]), ["Ohne GEO schickt die Aktualitätsprüfung nicht zurück; veraltete Abschnitte werden offene Punkte."]);
  assert.deepEqual(contentSkipWarnings(["geo", "aktualitaet"]), [], "nothing to send back without the check");
  assert.deepEqual(contentSkipWarnings(["seo"]), []);
  console.log("rerun, actions, review: ok");
}

// --- 10. PATCH validation --------------------------------------------------------------------------

{
  const body = (skip_steps: unknown) => ({ organisationId: ORG, skip_steps });
  const ok = parseContentPagePatch(body(["watermark", "seo", "seo"]));
  assert.ok(ok.ok && ok.data.skip_steps?.length === 3, "the schema takes the list; duplicates go when stored");
  const unknown = parseContentPagePatch(body(["recherche"]));
  assert.ok(!unknown.ok && unknown.message === "Unbekannter Schritt „recherche“.");
  const analyse = parseContentPagePatch(body(["analyse"]));
  assert.ok(!analyse.ok && /^„Analyse“ lässt sich nicht abschalten\. Läuft immer/.test(analyse.message));
  const endabnahme = parseContentPagePatch(body(["endabnahme"]));
  assert.ok(!endabnahme.ok && /Endabnahme/.test(endabnahme.message));
  assert.ok(!parseContentPagePatch(body("seo")).ok, "not a list");
  assert.ok(!parseContentPagePatch({ organisationId: ORG }).ok, "nothing to change");
  const type = parseContentPagePatch({ organisationId: ORG, page_type: "ratgeber" });
  assert.ok(type.ok && type.data.page_type === "ratgeber" && type.data.skip_steps === undefined, "the Seitentyp PATCH works as before");
  const badType = parseContentPagePatch({ organisationId: ORG, page_type: "irgendwas" });
  assert.ok(!badType.ok && badType.message === "Ungültiger Seitentyp.");

  const crawl = pageRow({ state: "in_arbeit" });
  const structure = pageRow({ state: "in_arbeit", source: "structure", source_url: null });
  assert.deepEqual(planContentSkipSteps({ ...crawl, state: "laeuft" }, ["geo"]), {
    ok: false,
    status: 409,
    message: "Die Seite läuft gerade – erst stoppen, dann Schritte ab- oder einschalten.",
  });
  for (const state of ["nicht_begonnen", "in_arbeit", "braucht_sie", "fertig"] as const) {
    assert.ok(planContentSkipSteps({ ...crawl, state }, ["geo"]).ok, `allowed while ${state}`);
  }
  const seoStructure = planContentSkipSteps(structure, ["seo"]);
  assert.ok(!seoStructure.ok && seoStructure.status === 400 && /^„SEO“ lässt sich für diese Seite nicht abschalten\. Nur bei Seiten von der Website/.test(seoStructure.message));
  assert.deepEqual(planContentSkipSteps(crawl, ["watermark", "seo", "seo", "geo"]), { ok: true, skipSteps: ["seo", "geo", "watermark"] }, "deduplicated, in step order");
  assert.deepEqual(planContentSkipSteps(crawl, []), { ok: true, skipSteps: [] }, "everything back on");
  assert.ok(planContentSkipSteps({ ...structure, skip_steps: ["seo"] }, ["seo", "geo"]).ok, "a page that lost its live URL may keep SEO on the list while other switches change");
  assert.ok(!planContentSkipSteps(crawl, ["analyse"]).ok);
}
console.log("PATCH validation: ok");

// --- 11. reset, upload, structure sync and crawl import keep the list ----------------------------

async function keepTests() {
  {
    const db = new FakeContentDb({
      dt_content_pages: [pageRow({ state: "fertig", step: 10, html: "<p>x</p>", skip_steps: ["geo", "watermark"], page_type: "ratgeber" })],
      dt_content_steps: [stepRow(1), stepRow(4, { status: "skipped", output: { skipped_by: "user" } })],
      jobs: [],
    });
    const result = await resetContentPage(db.service, pageRow({ skip_steps: ["geo", "watermark"] }));
    assert.ok(result.ok);
    assert.deepEqual([db.page().state, db.page().html, db.page().skip_steps, db.page().page_type], ["nicht_begonnen", "", ["geo", "watermark"], "ratgeber"], "„Zurücksetzen“ keeps the list like the type");
    assert.equal(db.rows("dt_content_steps").length, 0);
  }
  {
    const db = new FakeContentDb({
      dt_content_pages: [
        { ...pageRow({ slug: "implantate", source: "structure", source_url: null, skip_steps: ["geo"] }), structure_uploaded_at: "2026-10-01T00:00:00Z" },
        { ...pageRow({ id: "p-dach", slug: "dach", path: "/dach", source: "structure", source_url: null, skip_steps: ["hormozi"] }) },
      ],
    });
    const briefing = {
      slug: "implantate", name: "Implantate", path: "/implantate", level: 1, position: 0, page_role: "pillar" as const, page_type: "hauptsilo" as const, pillar_name: null,
      source_url: null, estimated_traffic: 10, keywords: { main: { text: "Implantate Krefeld" }, secondary: [] }, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
    };
    for (const mode of ["briefing", "structure"] as const) {
      await upsertContentPagesFromBriefing(db.service, ORG, [briefing], "2026-10-27T00:00:00Z", mode);
    }
    await applyContentBriefingUpdates(db.service, ORG, [{ slug: "implantate", page: briefing }], "2026-10-27T00:00:00Z", "briefing");
    for (const entry of db.log.filter((l) => l.table === "dt_content_pages" && (l.op === "upsert" || l.op === "update"))) {
      for (const row of [entry.payload].flat() as Row[]) assert.ok(!("skip_steps" in row), `${entry.op} never writes skip_steps`);
    }
    assert.deepEqual(db.page().skip_steps, ["geo"], "Excel upload and structure sync keep the list");
    assert.equal(db.page().page_type, "hauptsilo");

    db.tables.dt_site_pages = [
      { organisation_id: ORG, url: "https://praxis.de/dach", title: "Dach", h1: "Dach", is_excluded: false, crawled_at: "2026-10-20T10:00:00Z", final_url: null },
      { organisation_id: ORG, url: "https://praxis.de/neu", title: "Neu", h1: "Neu", is_excluded: false, crawled_at: "2026-10-20T10:00:00Z", final_url: null },
    ];
    db.log = [];
    const imported = await syncContentPagesFromCrawl(db.service, ORG);
    assert.equal(imported.attached, 1, "the crawl attaches its URL to the matching page");
    const dach = db.rows("dt_content_pages").find((p) => p.slug === "dach")!;
    assert.deepEqual([dach.source_url, dach.skip_steps], ["https://praxis.de/dach", ["hormozi"]], "crawl import keeps the list");
    for (const entry of db.log.filter((l) => l.table === "dt_content_pages" && l.op !== "select")) {
      for (const row of [entry.payload].flat() as Row[]) assert.ok(!("skip_steps" in row), `crawl ${entry.op} never writes skip_steps`);
    }
  }
  console.log("reset, upload, sync, crawl keep the list: ok");
}

runnerTests()
  .then(seoTests)
  .then(actionTests)
  .then(keepTests)
  .then(() => console.log("OK: skip steps tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
