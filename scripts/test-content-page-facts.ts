/**
 * Texte: the „Faktenauszug“ of a page. The steps used to read only the Anbieter evaluation
 * (thirteen sections for the whole company); what a workshop said about one Leistung rarely
 * reached the page about it. Now one call before the Analyse reads all conversations and keeps
 * what they say about this page's topic; the excerpt is stored in the Analyse's step row and is
 * part of the Anbieterfakten block of every step. In-memory database; no network, no model.
 * Run: npm run test:content-page-facts
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { ContentLlmError, type callContentTool } from "../lib/dt/content/pipeline/llm";
import { PAGE_FACTS_TOOL, PAGE_FACTS_USAGE_MODE, pageFactsCorpus, pageFactsPrompt } from "../lib/dt/content/pipeline/page-facts";
import {
  PAGE_FACTS_MAX,
  normalizePageFactLists,
  pageFactsBlock,
  pageFactsSummary,
  readPageFacts,
  withoutPageFacts,
  type ContentPageFacts,
} from "../lib/dt/content/pipeline/page-facts-model";
import { contentStepSpec, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { runPageFactsPart } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEPS, contentStepDefinition } from "../lib/dt/content/pipeline/steps";
import { reviewPageFacts, type ContentPageRow, type ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { WorkshopSource } from "../lib/dt/transcripts/workshop-model";

import { FakeDb } from "./fake-supabase";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Umzüge Muster",
  page: {
    name: "Klaviertransport", path: "/umzug/klaviertransport", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: "Umzug", estimated_traffic: null, keywords: null, h1_options: [], user_questions: ["Was kostet ein Klaviertransport?"], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen & Schwerpunkte", current: "Privatumzüge, Firmenumzüge, Klaviertransporte." }],
  settings: { anrede: "Sie", branche: "Umzug", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: { name: "Familie Berger", role: "Privatkunden", beschreibung: "Zieht mit Klavier um und hat Angst vor Schäden." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [{ id: "intro", heading: "Klaviertransport", level: 1, html: "<p>Text.</p>" }],
  title: null,
  metaDescription: null,
  ...patch,
});

const source = (n: number, patch: Partial<WorkshopSource> = {}): WorkshopSource => ({
  id: `s${n}`, title: `Workshop ${n}`, filename: null, sourceKind: "raw", spokenOn: `2026-0${n}-10`, createdAt: `2026-0${n}-11T10:00:00Z`,
  updatedAt: `2026-0${n}-11T10:00:00Z`, summary: `Zusammenfassung ${n}: Klaviere tragen wir zu viert.`, rawText: `Wortlaut ${n}: Ein Flügel kostet ab 480 Euro, das Treppenhaus messen wir vorher aus.`,
  ...patch,
});

const facts = (patch: Partial<ContentPageFacts> = {}): ContentPageFacts => ({
  facts: [
    { fact: "Ein Flügeltransport kostet ab 480 Euro.", topic: "Preis", source: "Gespräch 2", quote: "ab 480 Euro, je nach Stockwerk" },
    { fact: "Das Treppenhaus wird vor dem Termin ausgemessen.", topic: "Ablauf", source: "Gespräch 1", quote: "" },
  ],
  gaps: ["Versicherungssumme"],
  conversations: 2, shortened: false, error: null, at: "2026-11-10T10:00:00.000Z", model: "claude-sonnet-4-6", input_tokens: 90_000, output_tokens: 1_200, cost_eur: 0.27,
  ...patch,
});

// --- the prompt of the excerpt call ------------------------------------------------------------
{
  const prompt = pageFactsPrompt(context(), [source(2), source(1)]);
  assert.match(prompt.user, /Seite: Klaviertransport/);
  assert.match(prompt.user, /Was kostet ein Klaviertransport\?/, "the page's questions say what to look for");
  assert.match(prompt.user, /Familie Berger/, "the chosen avatar is part of the request");
  assert.ok(prompt.user.indexOf("Gespräch 1: 10.01.2026 · Workshop 1") < prompt.user.indexOf("Gespräch 2: 10.02.2026 · Workshop 2"), "conversation order, not upload order");
  assert.match(prompt.user, /Zusammenfassung 1[\s\S]*Wortlaut 1/, "summary and wording of each conversation");
  assert.doesNotMatch(prompt.user, /Leistungen & Schwerpunkte/, "the thirteen sections are not the source here");
  assert.equal(prompt.tool, PAGE_FACTS_TOOL);
  assert.equal(prompt.shortened, false);
  const schema = PAGE_FACTS_TOOL.input_schema as { properties: { facts: { maxItems: number } } };
  assert.equal(schema.properties.facts.maxItems, PAGE_FACTS_MAX);

  // Conversations longer than one call reads: summaries whole, the wording shortened evenly.
  const long = [source(1, { rawText: "a".repeat(300_000) }), source(2, { rawText: "b".repeat(300_000) })];
  const corpus = pageFactsCorpus(long, 100_000);
  assert.equal(corpus.shortened, true);
  assert.ok(corpus.text.length < 110_000, `shortened to about the budget (${corpus.text.length})`);
  assert.match(corpus.text, /Zusammenfassung 1[\s\S]*Zusammenfassung 2/);
  assert.match(corpus.text, /…\[gekürzt\]/);
  console.log("excerpt prompt: ok");
}

// --- normalising and storing -------------------------------------------------------------------
{
  const many = Array.from({ length: 80 }, (_, i) => ({ fact: `Fakt ${i}`, topic: "x", source: "Gespräch 1", quote: "" }));
  const out = normalizePageFactLists({ facts: [...many, { fact: "Fakt 0" }, { fact: "  " }], gaps: ["a", "", 3] });
  assert.equal(out.facts.length, PAGE_FACTS_MAX, "capped");
  assert.deepEqual(out.gaps, ["a"]);
  assert.deepEqual(normalizePageFactLists(null), { facts: [], gaps: [] });

  const stored = { intent: { primary: "transaktional" }, main_keyword: "klaviertransport", page_facts: facts() };
  assert.deepEqual(readPageFacts(stored), facts());
  assert.equal(readPageFacts({ intent: {} }), null, "a page started before the excerpt existed has none");
  assert.deepEqual(withoutPageFacts(stored), { intent: { primary: "transaktional" }, main_keyword: "klaviertransport" }, "the later prompts quote the Analyse without the excerpt");
  assert.equal(pageFactsSummary(facts()), "2 Fakten aus 2 Gesprächen");
  assert.equal(pageFactsSummary(facts({ facts: [], conversations: 0 })), "Kein Faktenauszug: keine Gespräche hochgeladen");
  assert.equal(pageFactsSummary(facts({ facts: [], error: "400" })), "Faktenauszug fehlgeschlagen");
  console.log("excerpt model: ok");
}

// --- every step with Anbieterfakten gets the excerpt --------------------------------------------
{
  const block = pageFactsBlock(facts());
  assert.match(block, /^### Faktenauszug für diese Seite \(aus den Kundengesprächen\)/);
  assert.match(block, /1\. \[Preis\] Ein Flügeltransport kostet ab 480 Euro\. \(Gespräch 2\) – Wortlaut: „ab 480 Euro, je nach Stockwerk“/);
  assert.equal(pageFactsBlock(null), "");
  assert.equal(pageFactsBlock(facts({ facts: [] })), "");

  const withFacts = context({ pageFacts: facts() });
  for (const key of ["analyse", "seo", "faktencheck", "geo", "hormozi", "vermenschlichung", "lektorat", "endabnahme"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    const user = contentStepSpec(def.step, withFacts).user;
    assert.ok(user.includes("Ein Flügeltransport kostet ab 480 Euro."), `${def.name} reads the excerpt`);
    assert.ok(user.indexOf("### Leistungen & Schwerpunkte") < user.indexOf("### Faktenauszug für diese Seite"), `${def.name}: inside the Anbieterfakten block, after the sections`);
    assert.ok(!contentStepSpec(def.step, context()).user.includes("Faktenauszug"), `${def.name}: nothing without an excerpt`);
  }
  console.log("excerpt in the prompts: ok");
}

// --- the first part of the Analyse step ----------------------------------------------------------
const pageRow = (): ContentPageRow => ({
  id: PAGE_ID, organisation_id: ORG, slug: "klaviertransport", name: "Klaviertransport", path: "/umzug/klaviertransport", level: 2, position: 0, source: "structure",
  source_url: null, crawled_at: null, main_keyword: null, page_role: "supporting", page_type: "unterseite", pillar_name: "Umzug",
  estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "laeuft", step: 1, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, skip_steps: [], client_wishes: "", question_stop: { handled: [] },
  error: null, job_id: JOB_ID, cost_eur: 0.1, started_by: null, created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z",
});

const transcript = (n: number) => ({
  id: `t${n}`, organisation_id: ORG, title: `Workshop ${n}`, filename: null, source_kind: "raw", spoken_on: `2026-0${n}-10`,
  created_at: `2026-0${n}-11T10:00:00Z`, updated_at: `2026-0${n}-11T10:00:00Z`, summary: `Zusammenfassung ${n}`, raw_text: `Wortlaut ${n}`,
});

type ToolCall = typeof callContentTool;

async function firstPart(input: { transcripts: number; callTool: ToolCall }) {
  const db = new FakeDb({
    dt_content_pages: [pageRow() as unknown as Record<string, unknown>],
    dt_content_steps: [{ page_id: PAGE_ID, organisation_id: ORG, step: 1, name: "Analyse", status: "running" }],
    dt_meeting_transcripts: Array.from({ length: input.transcripts }, (_, i) => transcript(i + 1)),
    dt_llm_usage_events: [],
  });
  const outcome = await runPageFactsPart({
    service: db.service, page: pageRow(), def: contentStepDefinition(1)!, context: context(), avatarId: null,
    models: ["claude-sonnet-4-6"], timeoutMs: 200_000, callTool: input.callTool,
  });
  const row = db.rows("dt_content_steps")[0] as unknown as ContentStepRow;
  return { db, outcome, row, page: db.rows("dt_content_pages")[0]! };
}

async function runnerTests() {
  // With conversations: one call, the excerpt in the step row, the step not done yet.
  const seen: Array<{ user: string; maxTokens: number }> = [];
  const answering: ToolCall = async (input) => {
    seen.push({ user: input.user, maxTokens: input.maxTokens });
    return {
      json: { facts: [{ fact: "Ein Flügeltransport kostet ab 480 Euro.", topic: "Preis", source: "Gespräch 2", quote: "" }], gaps: ["Versicherungssumme"] },
      usage: { inputTokens: 90_000, outputTokens: 1_200 },
      model: "claude-sonnet-4-6",
      stopReason: "tool_use",
    };
  };
  const ok = await firstPart({ transcripts: 2, callTool: answering });
  assert.equal(seen.length, 1);
  assert.match(seen[0]!.user, /Gespräch 2: 10\.02\.2026 · Workshop 2/);
  assert.deepEqual([ok.outcome.partial, ok.outcome.halted], [true, false], "the Analyse follows in the next loop turn");
  assert.equal(ok.row.status, "pending");
  const stored = readPageFacts(ok.row.output)!;
  assert.deepEqual([stored.facts.length, stored.gaps, stored.conversations, stored.error], [1, ["Versicherungssumme"], 2, null]);
  assert.ok(stored.cost_eur > 0 && ok.row.output_tokens === 1_200);
  assert.ok(Number(ok.page.cost_eur) > 0.1, "the call is on the page's cost");
  assert.equal((ok.db.rows("dt_llm_usage_events")[0] as { mode: string }).mode, PAGE_FACTS_USAGE_MODE);
  assert.equal(reviewPageFacts([ok.row])!.summary, "1 Fakt aus 2 Gesprächen");

  // No conversations: no call, an empty excerpt, the Analyse runs as before.
  const never: ToolCall = async () => {
    throw new Error("no call expected");
  };
  const none = await firstPart({ transcripts: 0, callTool: never });
  assert.equal(none.outcome.partial, true);
  assert.deepEqual([readPageFacts(none.row.output)!.conversations, readPageFacts(none.row.output)!.facts.length], [0, 0]);
  assert.equal(Number(none.page.cost_eur), 0.1);

  // A refused request does not stop the page: it runs without the excerpt and says why.
  const refusing: ToolCall = async () => {
    throw new ContentLlmError("prompt is too long", false);
  };
  const refused = await firstPart({ transcripts: 2, callTool: refusing });
  assert.equal(refused.outcome.partial, true);
  assert.equal(readPageFacts(refused.row.output)!.error, "prompt is too long");
  assert.equal(reviewPageFacts([refused.row])!.summary, "Faktenauszug fehlgeschlagen");

  // Overload or the time limit: the step fails and the job tries it again.
  const busy: ToolCall = async () => {
    throw new ContentLlmError("Die KI ist gerade ausgelastet.", true);
  };
  await assert.rejects(() => firstPart({ transcripts: 2, callTool: busy }), /ausgelastet/);
  console.log("first part of the Analyse: ok");
}

runnerTests()
  .then(() => console.log("OK: page facts tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
