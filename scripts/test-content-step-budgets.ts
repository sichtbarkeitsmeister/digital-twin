/**
 * Texte: room for the answers whose length grows with the page. The Faktencheck was cut off at
 * 6,000 output tokens on a long Startseite (27.10., 24 Abschnitte). Its budget must hold the most
 * the normaliser keeps (30 findings, 20 questions), the schema tells the model those caps, the
 * budget must be writable within one call, and the job loop starts such a step only with a long
 * slot. In-memory database; no network, no model.
 * Run: npm run test:content-step-budgets
 */
import assert from "node:assert/strict";

import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import {
  CONTENT_MAX_FINDINGS,
  CONTENT_MAX_QUESTIONS,
  ENDABNAHME_MAX_TOKENS,
  FAKTENCHECK_MAX_TOKENS,
  contentStepSpec,
  normalizeFindings,
  normalizeQuestions,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import type { StepOutcome } from "../lib/dt/content/pipeline/run-step";
import { CONTENT_STEP_ENDABNAHME, CONTENT_STEP_FAKTENCHECK, contentStepDefinition } from "../lib/dt/content/pipeline/steps";
import type { ContentPageRow, ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import { runContentPageSteps } from "../lib/jobs/handlers/content-page";
import { stepBudgetMs } from "../lib/jobs/schedule";

import { FakeDb } from "./fake-supabase";

/** Claude Sonnet wrote the cut-off Faktencheck (6,000 tokens) in 112 s on 27.10. */
const MEASURED_TOKENS_PER_SECOND = 54;
/** German JSON: about three characters per output token, rounded down to stay on the safe side. */
const CHARS_PER_TOKEN = 3;

const context = (): ContentPipelineContext => ({
  organisationName: "Antikankauf Kolb & Sartor",
  page: {
    name: "Startseite", path: "/", level: 0, url: null, source: "structure", page_role: "pillar", page_type: "startseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "unternehmen", label: "Unternehmen", current: "Ankauf von Antiquitäten, Silber und Gold in Hamburg." }],
  settings: { anrede: "Sie", branche: "Antiquitätenhandel", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [{ id: "intro", heading: "Antikankauf in Hamburg", level: 1, html: "<p>Wir kaufen Silber, Gold und Antiquitäten.</p>" }],
  title: null,
  metaDescription: null,
});

/** A Faktencheck answer at the normaliser's caps, with findings and questions as long as real ones. */
function maximalAnswer() {
  const findings = Array.from({ length: CONTENT_MAX_FINDINGS }, (_, i) => ({
    title: `Ankaufspreis für Silberbesteck ohne Beleg (${i + 1})`,
    problem: `Der Satz „Für 800er Silberbesteck zahlen wir bis zu 1,20 € pro Gramm, auch für Einzelteile und beschädigte Stücke“ nennt einen Preis, der in den Anbieterfakten nicht vorkommt. Auch die Zusage für beschädigte Stücke ist nicht belegt.`,
    proposal: "Den Preis streichen oder durch die Angabe aus den Anbieterfakten ersetzen; die Zusage für beschädigte Stücke nur übernehmen, wenn der Kunde sie bestätigt.",
    severity: "high",
    block_id: `abschnitt-${i + 1}`,
  }));
  const questions = Array.from({ length: CONTENT_MAX_QUESTIONS }, (_, i) => ({
    kind: "fact",
    question: `Kaufen Sie Nachlässe und Haushaltsauflösungen auch außerhalb von Hamburg an, und wenn ja, bis zu welcher Entfernung fahren Sie kostenlos zur Besichtigung? (${i + 1})`,
    field: "leistungen",
    placeholder: "Ja, im Umkreis von 100 km kostenlos.",
    block_id: `abschnitt-${i + 1}`,
    excerpt: "Wir kommen zu Ihnen nach Hause, schätzen kostenlos und zahlen sofort in bar – in ganz Norddeutschland, ohne Anfahrtskosten und ohne Mindestwert.",
    blocking: true,
  }));
  return { findings, questions };
}

{
  const spec = contentStepSpec(CONTENT_STEP_FAKTENCHECK, context());
  assert.equal(spec.maxTokens, FAKTENCHECK_MAX_TOKENS);

  // The most the normaliser keeps fits the budget; it did not fit the old 6,000.
  const answer = maximalAnswer();
  const tokens = JSON.stringify(answer).length / CHARS_PER_TOKEN;
  assert.ok(tokens * 1.1 <= FAKTENCHECK_MAX_TOKENS, `a maximal answer (~${Math.round(tokens)} tokens) fits ${FAKTENCHECK_MAX_TOKENS}`);
  assert.ok(tokens > 6_000, "and would have been cut off at the old 6,000");

  // One call can write the whole budget: at the measured speed within a long slot's time limit.
  const longSlotMs = stepBudgetMs(0, 240_000, 150_000)!;
  assert.ok((FAKTENCHECK_MAX_TOKENS / MEASURED_TOKENS_PER_SECOND) * 1_000 <= longSlotMs, "the budget is writable within one long slot");
  assert.ok((ENDABNAHME_MAX_TOKENS / MEASURED_TOKENS_PER_SECOND) * 1_000 <= longSlotMs);

  // The schema tells the model the caps the normaliser applies, most important first.
  const schema = spec.tool.input_schema as { properties: Record<string, { maxItems?: number }> };
  assert.equal(schema.properties.findings!.maxItems, CONTENT_MAX_FINDINGS);
  assert.equal(schema.properties.questions!.maxItems, CONTENT_MAX_QUESTIONS);
  assert.match(spec.tool.description ?? "", new RegExp(`höchstens ${CONTENT_MAX_FINDINGS} Befunde und ${CONTENT_MAX_QUESTIONS} Fragen, die wichtigsten zuerst`));
  const ids = new Set(answer.findings.map((f) => f.block_id));
  assert.equal(normalizeFindings([...answer.findings, ...answer.findings], ids).length, CONTENT_MAX_FINDINGS, "more than the cap is not kept");
  assert.equal(normalizeQuestions([...answer.questions, ...answer.questions], ids).length, CONTENT_MAX_QUESTIONS);

  // The other steps keep their schema: the Lektorat's findings carry no cap.
  const lektorat = contentStepSpec(8, context()).tool.input_schema as { properties: Record<string, { maxItems?: number }> };
  assert.equal(lektorat.properties.final_findings!.maxItems, undefined);
  console.log("Faktencheck budget: ok");
}

// --- the job loop gives the long checks a long slot ---------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const pageRow = (patch: Partial<ContentPageRow> = {}): ContentPageRow => ({
  id: PAGE_ID, organisation_id: ORG, slug: "startseite", name: "Startseite", path: "/", level: 0, position: 0, source: "structure",
  source_url: null, crawled_at: null, main_keyword: null, page_role: "pillar", page_type: "startseite", pillar_name: null,
  estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  state: "laeuft", step: null, released: false, released_at: null, title: null, meta_description: null, html: "", markdown: "",
  findings: [], final_findings: [], unresolved: [], questions: [], notes: [], freshness: EMPTY_CONTENT_FRESHNESS, skip_steps: [],
  error: null, job_id: JOB_ID, cost_eur: 0, started_by: null, created_at: "2026-10-27T16:55:40Z", updated_at: "2026-10-27T16:55:40Z",
  ...patch,
});

const doneUpTo = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ page_id: PAGE_ID, organisation_id: ORG, step: i + 1, name: contentStepDefinition(i + 1)!.name, status: "done" }));

async function loopSlot(stepsDone: number, secondsLeft: number): Promise<number[]> {
  const db = new FakeDb({ dt_content_pages: [pageRow({ step: stepsDone || null })], dt_content_steps: doneUpTo(stepsDone) });
  const calls: number[] = [];
  const runStep = async (_service: unknown, _page: ContentPageRow, _steps: readonly ContentStepRow[], step: number): Promise<StepOutcome> => {
    calls.push(step);
    return { step, halted: true, model: "claude-stub", costEur: 0 };
  };
  await runContentPageSteps({ service: db.service, job: { id: JOB_ID, attempts: 0, max_attempts: 3 }, pageId: PAGE_ID, deadline: Date.now() + secondsLeft * 1_000, runners: { runStep } });
  return calls;
}

async function slots() {
  assert.deepEqual(await loopSlot(2, 100), [], "100 s left: the Faktencheck waits for the next tick instead of running into the limit");
  assert.deepEqual(await loopSlot(2, 230), [CONTENT_STEP_FAKTENCHECK], "with a long slot it runs");
  assert.deepEqual(await loopSlot(9, 100), [], "the Endabnahme likewise");
  assert.deepEqual(await loopSlot(9, 230), [CONTENT_STEP_ENDABNAHME]);
  assert.deepEqual(await loopSlot(0, 100), [1], "the Analyse still starts with a short remainder");
  console.log("job loop slots: ok");
}

slots()
  .then(() => console.log("OK: step budget tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
