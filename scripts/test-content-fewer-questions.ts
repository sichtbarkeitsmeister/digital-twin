/**
 * Texte: far fewer customer questions. Topic suppression by the Kontaktdaten and the company
 * pool, the limit of three per page with the rest as open points, company questions into the
 * pool (once per organisation), no stop in steps 2–8, the one stop before the Watermark
 * Entfernung (also with Lektorat or Watermark switched off), the one „grundlegend“ early stop
 * (Faktencheck only, at most one), „Ohne Angabe weiter“ removing the sentence, the answers pass
 * changing only the affected Abschnitte, the Aktualitätsprüfung's carried questions, rerun,
 * stop and reset, and pages that wait under the old rules. In-memory database, stub model; no network.
 * Run: npm run test:content-fewer-questions
 */
import assert from "node:assert/strict";

import { EMPTY_ORG_CONTACT_DATA, contactFieldText, contactPromptData, phoneDigits, type OrgContactData } from "../lib/dt/contact-data";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { contentGapQuestions } from "../lib/dt/content/pipeline/gaps";
import { addOrgQuestions, contactFieldsForAnswer, customerAnswersFromPool, loadOrgQuestions } from "../lib/dt/content/org-questions";
import { approvalPatch, rerunPagePatch, resetContentPage, stopContentRun, submitContentAnswers } from "../lib/dt/content/pipeline/actions";
import { answerTargets, applyDrops, fillPlaceholder, noNewNumbers, normalizeAnswersOutput, removeSentenceWith } from "../lib/dt/content/pipeline/answers";
import {
  FAKTENCHECK_QUESTION_RULES,
  QUESTION_RULES,
  anbieterBlock,
  contentStepSpec,
  normalizeQuestions,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import {
  planQuestionStop,
  questionStopDue,
  questionStopOutcome,
  questionStopPassItems,
  readQuestionStop,
  type ContentHandledQuestion,
} from "../lib/dt/content/pipeline/question-stop";
import {
  CONTENT_MAX_PAGE_QUESTIONS,
  buildContentKnowledge,
  customerAnswerNote,
  isSourceQuestion,
  knownAnswerFor,
  normalizeQuestionScope,
  planContentQuestions,
  poolDedupeKey,
  questionTopic,
  type ContentPoolQuestion,
} from "../lib/dt/content/pipeline/questions";
import { runQuestionStop, type QuestionStopOutcome } from "../lib/dt/content/pipeline/run-step";
import { planFreshness, stepPatchFor, withContactSpelling, withDateMarker } from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEP_AKTUALITAET,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_GEO,
  CONTENT_STEP_HORMOZI,
  CONTENT_STEP_LEKTORAT,
  CONTENT_STEP_SEO,
  CONTENT_STEP_VERMENSCHLICHUNG,
  CONTENT_STEP_WATERMARK,
  CONTENT_STEPS,
  contentStepDefinition,
} from "../lib/dt/content/pipeline/steps";
import { parseBlocksFromHtml, renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { buildReview, contentDbErrorMessage, pageDetail, type ContentPageRow, type ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentQuestion } from "../lib/dt/content/types";
import { runContentPageSteps } from "../lib/jobs/handlers/content-page";
import { FakeDb, type FakeRow } from "./fake-supabase";

const ORG = "00000000-0000-4000-8000-000000000001";
const PAGE_ID = "00000000-0000-4000-8000-0000000000p1".replace("p1", "a1");
const JOB_ID = "00000000-0000-4000-8000-0000000000b1";
const USER = "00000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-11-04T10:00:00Z");

const BLOCKS: ContentTextBlock[] = [
  { id: "h1", heading: "Steuerberatung in Köln", level: 1, html: "" },
  { id: "hero", heading: null, level: 2, html: "<p>Steuern ohne Stress.</p>" },
  { id: "kosten", heading: "Was kostet die Beratung?", level: 2, html: "<p>Die Erstberatung ist kostenlos. Danach kostet die Stunde [BITTE PRÜFEN: Preis pro Stunde]. Sie zahlen erst nach dem Termin.</p>" },
  { id: "kontakt", heading: "So erreichen Sie uns", level: 2, html: "<p>Rufen Sie an unter [BITTE PRÜFEN: Telefonnummer]. Wir melden uns innerhalb eines Tages.</p>" },
  { id: "ablauf", heading: "Wie läuft es ab?", level: 2, html: "<p>Sie schicken uns Ihre Unterlagen. Wir prüfen sie in 5 Tagen. Mehr unter [LINK: Leistungen].</p>" },
  { id: "stand", heading: null, level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
];
const HTML = renderBlocksHtml(BLOCKS);

function contact(fields: Partial<Record<keyof OrgContactData["fields"], string>>, noGoogle = false): OrgContactData {
  return {
    ...EMPTY_ORG_CONTACT_DATA,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, source: "crawl", updated_at: null }])),
    custom: [],
    no_google_profile: noGoogle,
  };
}

function q(question: string, extra: Partial<ContentQuestion> = {}): ContentQuestion {
  return { kind: "fact", question, blocking: true, ...extra };
}

// --- B: ask less ----------------------------------------------------------------------------------

function testTopicsAndSuppression() {
  assert.equal(questionTopic(q("Wie lautet Ihre Telefonnummer?")), "telefon");
  assert.equal(questionTopic(q("Haben Sie eine Handynummer für WhatsApp?")), "mobil");
  assert.equal(questionTopic(q("Wann sind Ihre Öffnungszeiten?")), "oeffnungszeiten");
  assert.equal(questionTopic(q("Wie viele Google-Bewertungen haben Sie?")), "bewertungen", "a rating is no link");
  assert.equal(questionTopic(q("Haben Sie ein Google-Profil?")), "google_profil");
  assert.equal(questionTopic(q("Gibt es ein kurzes telefonisches Kennenlernen vor dem Termin?")), null, "„telefonisch“ is no phone-number question");
  assert.equal(questionTopic(q("x", { placeholder: "[BITTE PRÜFEN: Adresse der Kanzlei]" })), "adresse");
  assert.equal(questionTopic(q("Wie heißt der Inhaber?")), "ansprechpartner");
  assert.equal(questionTopic(q("Was kostet die Stunde?", { excerpt: "Termin per Telefon vereinbaren" })), null, "the sentence around it does not count");
  // Two topics in one placeholder: a company question, filled only when both are known.
  const both = normalizeQuestionScope(q("x", { placeholder: "[BITTE PRÜFEN: Öffnungszeiten und Telefonnummer]" }));
  assert.deepEqual([both.scope, both.topic], ["firma", null], "no single Kontaktdaten field for its answer");
  assert.equal(knownAnswerFor(both, buildContentKnowledge({ contact: contact({ telefon: "0221 1" }) })), null, "the phone alone is not the answer");
  assert.deepEqual(knownAnswerFor(both, buildContentKnowledge({ contact: contact({ telefon: "0221 1", oeffnungszeiten: "Mo–Fr 8–17 Uhr" }) })), { action: "answer", value: "Telefon: 0221 1; Öffnungszeiten: Mo–Fr 8–17 Uhr", source: "kontaktdaten" });
  const narrowed = planContentQuestions({
    candidates: [q("x", { placeholder: "[BITTE PRÜFEN: Telefonnummer und Erreichbarkeitszeiten]" }), q("Wann sind Sie erreichbar (Öffnungszeiten)?")],
    blocks: [],
    step: CONTENT_STEP_FAKTENCHECK,
    knowledge: buildContentKnowledge({ contact: contact({ telefon: "0221 1" }) }),
  });
  assert.deepEqual(narrowed.firma.map((f) => f.topic), ["oeffnungszeiten"], "phone known: both are one question about the opening hours");

  const blocks = parseBlocksFromHtml(HTML);
  // As after a step: the model's questions plus the placeholders of the text.
  const candidates = contentGapQuestions(blocks, [
    q("Wie lautet Ihre Telefonnummer?", { block_id: "kontakt", scope: "seite" }),
    q("Wie viele Google-Bewertungen haben Sie?"),
    q("Wann haben Sie geöffnet?"),
    q("Bieten Sie Beratung am Samstag an?", { block_id: "ablauf" }),
  ]);
  const none = planContentQuestions({ candidates, blocks, step: CONTENT_STEP_FAKTENCHECK });
  assert.deepEqual(none.firma.map((f) => f.topic).sort(), ["bewertungen", "oeffnungszeiten", "telefon"], "topics in the map are always „firma“, even when the model said „seite“");
  assert.ok(none.page.every((p) => p.scope === "seite"));
  assert.equal(none.firma.length, 3, "the placeholder [BITTE PRÜFEN: Telefonnummer] and the model's phone question are one");

  // Kontaktdaten filled: those topics are dropped; „Kein Google-Profil“ answers the Bewertungen.
  const known = buildContentKnowledge({ contact: contact({ telefon: "0221 1234", oeffnungszeiten: "Mo–Fr 8–17 Uhr" }, true) });
  const withContact = planContentQuestions({ candidates, blocks, step: CONTENT_STEP_FAKTENCHECK, knowledge: known });
  assert.deepEqual(withContact.firma, [], "nothing the Kontaktdaten know is asked");
  assert.deepEqual(withContact.suppressed.map((s) => s.reason), ["steht in den Kontaktdaten", "steht in den Kontaktdaten", "steht in den Kontaktdaten"]);

  // An answered pool question (any page) is never asked again; nor a pool „Keine Angabe“.
  const pool: ContentPoolQuestion[] = [
    { id: "p1", dedupe_key: "oeffnungszeiten", topic_key: "oeffnungszeiten", question: "Öffnungszeiten?", status: "answered", answer: "Mo–Do 9–18 Uhr", page_slugs: ["a"] },
    { id: "p2", dedupe_key: "bewertungen", topic_key: "bewertungen", question: "Bewertungen?", status: "no_answer", answer: null, page_slugs: ["a"] },
    { id: "p3", dedupe_key: "text:bieten sie beratung am samstag an", topic_key: null, question: "Bieten Sie Beratung am Samstag an?", status: "answered", answer: "Nein", page_slugs: ["a"] },
  ];
  const withPool = planContentQuestions({ candidates, blocks, step: CONTENT_STEP_FAKTENCHECK, knowledge: buildContentKnowledge({ pool }) });
  assert.deepEqual(withPool.firma.map((f) => f.topic), ["telefon"], "only the topic nobody answered");
  assert.deepEqual(withPool.page.map((p) => p.question), ["Preis pro Stunde – was soll hier stehen?"], "the Samstag question was answered in the pool");

  // A review placeholder with the Google-Profil known: left out (never filled with the link, never invented).
  const reviewGap = contentGapQuestions(parseBlocksFromHtml(renderBlocksHtml([{ id: "stimmen", heading: "Das sagen Patienten", level: 2, html: "<p>[BITTE PRÜFEN: echte Google-Bewertung einsetzen]</p>" }])), []);
  const withLink = buildContentKnowledge({ contact: contact({ google_profil: "https://g.page/kanzlei" }) });
  const reviewStop = planQuestionStop({ blocks: parseBlocksFromHtml(renderBlocksHtml([{ id: "stimmen", heading: "Das sagen Patienten", level: 2, html: "<p>[BITTE PRÜFEN: echte Google-Bewertung einsetzen]</p>" }])), questions: reviewGap, knowledge: withLink, slug: "x" });
  assert.deepEqual(reviewStop.handled.map((h) => [h.action, h.answer]), [["drop", null]], "the review sentence goes, the link is not put in");

  // Anbieterfakten and editor notes count as known too; so does an earlier answer on the page.
  const facts = buildContentKnowledge({ anbieterText: "Kontakt: Telefon: 0221 555 66 77, info@kanzlei.de", notes: [customerAnswerNote("Bieten Sie Beratung am Samstag an?", "Ja, nach Termin")] });
  assert.equal(facts.values.telefon?.source, "fakten");
  const fromFacts = planContentQuestions({ candidates, blocks, step: CONTENT_STEP_FAKTENCHECK, knowledge: facts });
  assert.ok(!fromFacts.firma.some((f) => f.topic === "telefon"));
  assert.ok(!fromFacts.page.some((p) => /Samstag/.test(p.question)), "answered before on this page");
  console.log("B: topic map and suppression: ok");
}

function testLimitAndOverflow() {
  const blocks = parseBlocksFromHtml(HTML);
  const many = [
    q("Welche Software nutzen Sie?", { block_id: "ablauf", severity: "low" }),
    q("Gilt die kostenlose Erstberatung für alle?", { block_id: "kosten", severity: "high", excerpt: "Die Erstberatung ist kostenlos." }),
    q("Prüfen Sie wirklich in 5 Tagen?", { block_id: "ablauf", severity: "medium" }),
    q("Beraten Sie auch Firmen?", { block_id: "hero", severity: "medium" }),
    q("Gibt es Abendtermine?", { block_id: "ablauf", severity: "low" }),
  ];
  const plan = planContentQuestions({ candidates: many, blocks, step: CONTENT_STEP_FAKTENCHECK });
  assert.equal(CONTENT_MAX_PAGE_QUESTIONS, 3);
  assert.equal(plan.page.length, 3, "at most three on the page");
  assert.deepEqual(plan.page.map((p) => p.question), [
    "Gilt die kostenlose Erstberatung für alle?",
    "Prüfen Sie wirklich in 5 Tagen?",
    "Beraten Sie auch Firmen?",
  ], "severity first, then order");
  assert.equal(plan.overflow.length, 2, "the two low ones are left over");
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: many }, { html: HTML });
  assert.equal(patch.halted, false, "the overflow does not stop the page");
  const findings = patch.pagePatch.findings as Array<{ title: string; severity: string }>;
  assert.equal(findings.filter((f) => f.title === "Offene Frage (nicht gestellt)").length, 3, "the rest (two low ones and the price placeholder) are open points");
  assert.equal((patch.questionPlan!.unasked_questions as string[]).length, 3, "recorded as unasked in the step output");

  // Found in the end-to-end run: the same question as page and company question, and a wish conflict asked as a question.
  const twice = planContentQuestions({
    candidates: [q("Werden Entsorgungsnachweise ausgestellt?", { scope: "firma", block_id: "ablauf" }), q("Werden Entsorgungsnachweise ausgestellt?", { scope: "seite", block_id: "kosten" })],
    blocks,
    step: CONTENT_STEP_FAKTENCHECK,
  });
  assert.deepEqual([twice.firma.length, twice.page.length], [1, 0], "asked once, as the company question");
  const pooled = planContentQuestions({
    candidates: [q("Werden Entsorgungsnachweise ausgestellt?", { scope: "seite" })],
    blocks,
    step: CONTENT_STEP_LEKTORAT,
    knowledge: buildContentKnowledge({ pool: [{ id: "p", dedupe_key: "text:werden entsorgungsnachweise ausgestellt", topic_key: null, question: "Werden Entsorgungsnachweise ausgestellt?", status: "open", answer: null, page_slugs: ["x"] }] }),
  });
  assert.deepEqual([pooled.firma.length, pooled.page.length], [1, 0], "a page question the pool holds goes to the pool");
  const conflict = stepPatchFor(
    contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!,
    { findings: [], questions: [q("Der Wunsch „Firmenname immer ‚Einfach Entrümpelung‘“ kollidiert mit den Kontaktdaten. Soll die Langform bleiben?")] },
    { html: renderBlocksHtml(BLOCKS.filter((b) => b.id !== "kosten" && b.id !== "kontakt")) },
  );
  assert.deepEqual([(conflict.pagePatch.questions as unknown[]).length, conflict.firmaQuestions?.length ?? 0], [0, 0], "a wish conflict is no question");
  assert.ok((conflict.pagePatch.findings as Array<{ title: string }>).some((f) => f.title === "Kundenwunsch im Konflikt"), "but an open point");
  console.log("B: three per page, the rest as open points: ok");
}

// --- C: company questions once per organisation ------------------------------------------------------

async function testPool() {
  const db = new FakeDb();
  const telefonA = q("Wie lautet Ihre Telefonnummer?", { topic: "telefon", scope: "firma", placeholder: "[BITTE PRÜFEN: Telefonnummer]" });
  const telefonB = q("Unter welcher Nummer sind Sie erreichbar (Telefon)?", { topic: "telefon", scope: "firma" });
  const samstag = q("Arbeiten Sie auch samstags?", { scope: "firma" });
  await addOrgQuestions(db.service as never, ORG, "steuerberatung", [telefonA, samstag]);
  await addOrgQuestions(db.service as never, ORG, "lohnbuchhaltung", [telefonB, q("Arbeiten Sie auch samstags?", { scope: "firma" })]);
  const rows = await loadOrgQuestions(db.service as never, ORG);
  assert.equal(rows.length, 2, "one row per topic or text, however many pages ask");
  assert.deepEqual(rows.find((r) => r.topic_key === "telefon")!.page_slugs, ["steuerberatung", "lohnbuchhaltung"]);
  assert.equal(poolDedupeKey(samstag), "text:arbeiten sie auch samstags");
  assert.deepEqual(contactFieldsForAnswer("adresse", "Hauptstraße 1, 50667 Köln"), { strasse: "Hauptstraße 1", plz: "50667", ort: "Köln" }, "an address answer goes into the Kontaktdaten");
  assert.deepEqual(contactFieldsForAnswer("telefon", "0221 1"), { telefon: "0221 1" });
  assert.equal(contactFieldsForAnswer("google_profil", "4,8 Sterne bei 120 Bewertungen"), null, "no link: a fact, not a field");
  assert.deepEqual(
    customerAnswersFromPool([
      { id: "1", dedupe_key: "telefon", topic_key: "telefon", question: "Telefon?", status: "answered", answer: "0221 1", page_slugs: [] },
      { id: "2", dedupe_key: "text:x", topic_key: null, question: "Arbeiten Sie samstags?", status: "answered", answer: "Ja", page_slugs: [] },
    ]),
    [{ question: "Arbeiten Sie samstags?", answer: "Ja" }],
    "answers that are no Kontaktdaten field become „Antworten des Kunden“",
  );
  assert.match(anbieterBlock({ sections: [], customerAnswers: [{ question: "Arbeiten Sie samstags?", answer: "Ja" }] }), /### Antworten des Kunden \(bestätigt\)\n- Arbeiten Sie samstags\? → Ja/);
  console.log("C: company questions into the pool, deduplicated: ok");
}

// --- A: no stop in steps 2–8, one stop before the Watermark -------------------------------------------

function testNoHaltInSteps() {
  const out = { blocks: parseBlocksFromHtml(HTML), title: "T", meta_description: "M" };
  for (const step of [CONTENT_STEP_SEO, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG]) {
    const patch = stepPatchFor(contentStepDefinition(step)!, out);
    assert.deepEqual([patch.halted, patch.pagePatch.state], [false, undefined], `step ${step} goes on`);
    assert.equal((patch.pagePatch.questions as ContentQuestion[]).length, 1, `step ${step}: the price placeholder is collected`);
    assert.deepEqual(patch.firmaQuestions?.map((f) => f.topic), ["telefon"], `step ${step}: the phone goes to the pool`);
  }
  const lektorat = stepPatchFor(contentStepDefinition(CONTENT_STEP_LEKTORAT)!, { ...out, final_findings: [] });
  assert.equal(lektorat.halted, false);
  const fakten = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [q("Stimmt die Erstberatung?", { blocking: true })] }, { html: HTML });
  assert.equal(fakten.halted, false, "even a blocking Faktencheck question waits for the stop");

  // Aktualitätsprüfung: its carried questions join the single stop.
  const stored = { ...EMPTY_CONTENT_FRESHNESS, sendbacks: 1, carried_questions: [q("Gilt der Preis noch? (Quelle: https://example.org)", { kind: "outdated", block_id: "kosten" })] };
  const freshness = planFreshness(stored, { updates: [], questions: [], outdated_sections: [], findings: [], blocks: out.blocks }, NOW.toISOString());
  assert.equal(freshness.questions.length, 1);
  const akt = stepPatchFor(
    contentStepDefinition(CONTENT_STEP_AKTUALITAET)!,
    { ...out, checked: [], updates: [], questions: [], outdated_sections: [], findings: [], unasked_questions: [], research: { searches: 1, fetches: 0, sources: 1, claims: 1, search_limit_hit: false } },
    { html: HTML, freshness: stored },
    NOW,
  );
  assert.equal(akt.halted, false, "the Aktualitätsprüfung does not stop on its own");
  assert.ok((akt.pagePatch.questions as ContentQuestion[]).some((x) => /Gilt der Preis noch/.test(x.question)), "its carried question is collected");
  console.log("A: no stop in steps 2–8: ok");
}

function testGrundlegend() {
  const blocks = parseBlocksFromHtml(HTML);
  const two = [
    q("Bieten Sie Steuerberatung überhaupt an?", { grundlegend: true, severity: "medium" }),
    q("Beraten Sie wirklich in Köln?", { grundlegend: true, severity: "high" }),
  ];
  const plan = planContentQuestions({ candidates: two, blocks, step: CONTENT_STEP_FAKTENCHECK });
  assert.equal(plan.page.filter((p) => p.grundlegend).length, 1, "at most one");
  assert.equal(plan.grundlegend?.question, "Beraten Sie wirklich in Köln?", "the more severe one");
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: two }, { html: HTML });
  assert.deepEqual([patch.halted, patch.stepStatus, patch.pagePatch.state], [true, "waiting", "braucht_sie"], "stops right after the Faktencheck");
  const elsewhere = planContentQuestions({ candidates: two, blocks, step: CONTENT_STEP_AKTUALITAET });
  assert.equal(elsewhere.grundlegend, null, "only the Faktencheck may stop early");
  assert.equal(elsewhere.page.some((p) => p.grundlegend), false);
  assert.equal(normalizeQuestions([{ question: "X?", grundlegend: true, scope: "firma", severity: "high" }], new Set())[0]!.grundlegend, true);
  console.log("A: the one „grundlegend“ early stop: ok");
}

function testStopIsDue() {
  const rows = (upTo: number, extra: Array<{ step: number; status: string }> = []) => [
    ...CONTENT_STEPS.filter((s) => s.step <= upTo).map((s) => ({ step: s.step, status: "done" })),
    ...extra,
  ];
  assert.equal(questionStopDue({}, rows(8), CONTENT_STEP_WATERMARK), true, "after the Lektorat, before Watermark");
  assert.equal(questionStopDue({}, rows(6), CONTENT_STEP_VERMENSCHLICHUNG), false, "not before");
  assert.equal(questionStopDue({ status: "done" }, rows(8), CONTENT_STEP_WATERMARK), false, "only once");
  assert.equal(questionStopDue({}, rows(8, [{ step: 9, status: "skipped" }]), CONTENT_STEP_ENDABNAHME), false, "a page that passed Watermark before this rule keeps its course");
  assert.equal(questionStopDue({}, rows(9), CONTENT_STEP_ENDABNAHME), false, "legacy: Watermark done");
  assert.equal(questionStopDue({ status: "answered" }, rows(8), CONTENT_STEP_WATERMARK), true, "answers waiting for the pass");
  console.log("A: when the stop is due: ok");
}

// --- the job loop with the stop ------------------------------------------------------------------------

class PageDb extends FakeDb {
  page(): FakeRow {
    return this.rows("dt_content_pages").find((p) => p.id === PAGE_ID)!;
  }
}

function pageRow(patch: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    id: PAGE_ID,
    organisation_id: ORG,
    slug: "steuerberatung",
    name: "Steuerberatung",
    path: "/steuerberatung",
    level: 1,
    position: 0,
    source: "structure",
    source_url: null,
    crawled_at: null,
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
    step: 1,
    released: false,
    released_at: null,
    title: "T",
    meta_description: "M",
    html: HTML,
    markdown: "",
    findings: [],
    final_findings: [],
    unresolved: [],
    questions: [],
    notes: [],
    freshness: EMPTY_CONTENT_FRESHNESS,
    skip_steps: [],
    client_wishes: "",
    question_stop: { handled: [] },
    error: null,
    job_id: JOB_ID,
    cost_eur: 1,
    started_by: USER,
    created_at: "2026-11-04T09:00:00Z",
    updated_at: "2026-11-04T09:00:00Z",
    ...patch,
  };
}

function stepRow(step: number, status = "done"): FakeRow {
  return { id: `s${step}`, page_id: PAGE_ID, organisation_id: ORG, step, name: contentStepDefinition(step)!.name, status, output: {}, cost_eur: 0 };
}

async function testStopInTheLoop() {
  for (const skip of [[], ["lektorat"], ["watermark"]] as const) {
    const db = new PageDb({
      jobs: [{ id: JOB_ID, status: "running" }],
      dt_content_pages: [pageRow({ step: 7, skip_steps: [...skip] }) as unknown as FakeRow],
      dt_content_steps: [1, 2, 3, 4, 5, 6, 7].map((n) => stepRow(n)),
    });
    const calls: string[] = [];
    const runStep = async (_s: unknown, _p: ContentPageRow, _st: readonly ContentStepRow[], step: number) => {
      calls.push(`step ${step}`);
      const existing = db.rows("dt_content_steps").find((r) => r.step === step);
      const row = stepRow(step, step === CONTENT_STEP_ENDABNAHME ? "waiting" : "done");
      if (existing) Object.assign(existing, row);
      else db.rows("dt_content_steps").push(row);
      Object.assign(db.page(), { step, ...(step === CONTENT_STEP_ENDABNAHME ? { state: "fertig" } : {}) });
      return { step, halted: step === CONTENT_STEP_ENDABNAHME, model: "stub", costEur: 0 };
    };
    const questionStop = async (): Promise<QuestionStopOutcome> => {
      calls.push("stop");
      Object.assign(db.page(), { state: "braucht_sie", job_id: null, question_stop: { status: "waiting", handled: [] } });
      return { action: "ask", halted: true, model: "", costEur: 0 };
    };
    const result = await runContentPageSteps({
      service: db.service as never,
      job: { id: JOB_ID, attempts: 0, max_attempts: 3 },
      pageId: PAGE_ID,
      deadline: Date.now() + 240_000,
      runners: { runStep, questionStop },
    });
    const ranBefore = skip.includes("lektorat" as never) ? [] : ["step 8"];
    assert.deepEqual(calls, [...ranBefore, "stop"], `skip ${skip.join(",") || "nothing"}: one stop after the last step before Watermark`);
    assert.equal(result.ok && result.result?.halted, true);
    assert.equal(db.page().state, "braucht_sie");
  }
  {
    // After the stop: the run goes on with Watermark and the Endabnahme, and does not stop again.
    const db = new PageDb({
      jobs: [{ id: JOB_ID, status: "running" }],
      dt_content_pages: [pageRow({ step: 8, question_stop: { status: "done", handled: [] } }) as unknown as FakeRow],
      dt_content_steps: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => stepRow(n)),
    });
    const calls: string[] = [];
    await runContentPageSteps({
      service: db.service as never,
      job: { id: JOB_ID, attempts: 0, max_attempts: 3 },
      pageId: PAGE_ID,
      deadline: Date.now() + 240_000,
      runners: {
        runStep: async (_s, _p, _st, step) => {
          calls.push(`step ${step}`);
          db.rows("dt_content_steps").push(stepRow(step, step === CONTENT_STEP_ENDABNAHME ? "waiting" : "done"));
          if (step === CONTENT_STEP_ENDABNAHME) Object.assign(db.page(), { state: "fertig" });
          return { step, halted: step === CONTENT_STEP_ENDABNAHME, model: "stub", costEur: 0 };
        },
        questionStop: async () => {
          calls.push("stop");
          return { action: "go_on", halted: false, model: "", costEur: 0 };
        },
      },
    });
    assert.deepEqual(calls, ["step 9", "step 10"], "Watermark and Endabnahme, no second stop");
  }
  console.log("A: the single stop in the job loop (also with Lektorat or Watermark off): ok");
}

// --- the stop itself and the answers pass -------------------------------------------------------------

const settings = { anrede: "Sie" as const, branche: "Steuerberatung", tonalitaet: "sachlich" as never, verbotene_woerter: [] };

function context(extra: Partial<ContentPipelineContext> = {}): ContentPipelineContext {
  return {
    organisationName: "Kanzlei Müller",
    page: { name: "Steuerberatung", path: "/steuerberatung", level: 1, source: "structure", page_role: null, page_type: "unterseite", pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [] },
    structureOutline: "",
    existingText: null,
    sections: [],
    settings,
    avatar: null,
    typePrompts: DEFAULT_CONTENT_TYPE_PROMPTS,
    notes: [],
    outputs: {},
    blocks: parseBlocksFromHtml(HTML),
    title: "T",
    metaDescription: "M",
    knowledge: buildContentKnowledge({}),
    ...extra,
  };
}

async function testStopAsksOnce() {
  const db = new PageDb({ dt_content_pages: [pageRow({ step: 8 }) as unknown as FakeRow] });
  const page = pageRow({ step: 8 });
  const outcome = await runQuestionStop(db.service as never, page, [], 240_000, { context: context(), now: NOW, callTool: async () => assert.fail("no model call when asking") });
  assert.deepEqual([outcome.action, outcome.halted], ["ask", true]);
  assert.equal(db.page().state, "braucht_sie");
  assert.deepEqual((db.page().questions as ContentQuestion[]).map((x) => x.question), ["Preis pro Stunde – was soll hier stehen?"], "the page's own question");
  const stop = readQuestionStop(db.page().question_stop);
  assert.deepEqual([stop.status, stop.asked], ["waiting", 2], "one merged list: the price and the company's phone");
  const pool = await loadOrgQuestions(db.service as never, ORG);
  assert.deepEqual(pool.map((r) => [r.topic_key, r.status, r.page_slugs]), [["telefon", "open", ["steuerberatung"]]], "the phone is asked once for the organisation");
  assert.match(pageDetail({ ...page, state: "braucht_sie", question_stop: stop, questions: db.page().questions as ContentQuestion[] }) ?? "", /2 Fragen vor der Watermark Entfernung/);

  // Nothing to ask, the phone known from the Kontaktdaten: the pass fills it in, no stop.
  const known = context({ knowledge: buildContentKnowledge({ contact: contact({ telefon: "0221 123456" }) }) });
  const db2 = new PageDb({ dt_content_pages: [pageRow({ step: 8, html: renderBlocksHtml(BLOCKS.filter((b) => b.id !== "kosten")) }) as unknown as FakeRow] });
  let calls = 0;
  const passed = await runQuestionStop(db2.service as never, pageRow({ step: 8, html: renderBlocksHtml(BLOCKS.filter((b) => b.id !== "kosten")) }), [], 240_000, {
    context: known,
    now: NOW,
    models: ["claude-stub"],
    callTool: async (input) => {
      calls += 1;
      assert.match(input.user, /Antwort des Kunden: 0221 123456/);
      assert.doesNotMatch(input.user, /Wie läuft es ab/, "only the affected Abschnitt goes to the model");
      return { json: { blocks: [{ id: "kontakt", heading: "So erreichen Sie uns", level: 2, html: "<p>Rufen Sie an unter 0221 123456. Wir melden uns innerhalb eines Tages.</p>" }] }, usage: { inputTokens: 900, outputTokens: 80 }, model: "claude-stub" };
    },
  });
  assert.deepEqual([passed.action, passed.halted, calls], ["pass", false, 1]);
  assert.match(String(db2.page().html), /Rufen Sie an unter 0221 123456/);
  assert.equal(readQuestionStop(db2.page().question_stop).status, "done");
  assert.ok(Number(db2.page().cost_eur) > 1, "the pass's cost goes on the page");
  assert.equal(db2.rows("dt_llm_usage_events")[0]?.mode, "content.answers", "usage mode content.answers, no step number");
  assert.equal(db2.rows("dt_content_steps").length, 0, "no step row for the pass");

  // Nothing at all: straight on.
  const db3 = new PageDb({ dt_content_pages: [pageRow({ step: 8, html: renderBlocksHtml(BLOCKS.filter((b) => b.id !== "kosten" && b.id !== "kontakt")) }) as unknown as FakeRow] });
  const clean = await runQuestionStop(db3.service as never, pageRow({ step: 8, html: renderBlocksHtml(BLOCKS.filter((b) => b.id !== "kosten" && b.id !== "kontakt")) }), [], 240_000, { context: context(), now: NOW });
  assert.deepEqual([clean.action, clean.halted, readQuestionStop(db3.page().question_stop).status], ["go_on", false, "done"]);
  console.log("A: the stop asks once, or fills in what is known: ok");
}

async function testAnswerAndDrop() {
  // The customer answers the price and the phone question in the pool: „Antworten einarbeiten & weiter“.
  const asked = pageRow({ state: "braucht_sie", step: 8, job_id: null });
  const plan = planQuestionStop({ blocks: parseBlocksFromHtml(HTML), questions: [], knowledge: buildContentKnowledge({}), slug: asked.slug });
  assert.equal(questionStopOutcome(plan), "ask");
  const price = plan.ask[0]!;
  const waiting = pageRow({ ...asked, questions: plan.ask, question_stop: { status: "waiting", asked: 2, handled: [] } });
  const db = new PageDb({
    dt_content_pages: [waiting as unknown as FakeRow],
    dt_content_org_questions: [{ id: "00000000-0000-4000-8000-0000000000f1", organisation_id: ORG, dedupe_key: "telefon", topic_key: "telefon", question: "Telefonnummer – was soll hier stehen?", status: "open", answer: null, page_slugs: ["steuerberatung"] }],
  });
  const early = await submitContentAnswers(db.service as never, waiting, { answers: [{ id: price.id!, action: "drop" }], submit: true }, USER);
  assert.ok(!early.ok && /zum Unternehmen offen/.test(early.message), "the company question must be answered first");
  const saved = await submitContentAnswers(db.service as never, waiting, { answers: [{ id: price.id!, action: "drop" }], submit: false }, USER);
  assert.ok(saved.ok);
  assert.equal(readQuestionStop(db.page().question_stop).handled[0]?.action, "drop", "the decision is saved");

  // „Ohne Angabe weiter“ removes the sentence with the placeholder, in code.
  const kosten = BLOCKS.find((b) => b.id === "kosten")!;
  const removed = removeSentenceWith(kosten, "[BITTE PRÜFEN: Preis pro Stunde]")!;
  assert.equal(removed.html, "<p>Die Erstberatung ist kostenlos. Sie zahlen erst nach dem Termin.</p>");
  const only = removeSentenceWith({ id: "x", heading: null, level: 2, html: "<ul><li>Preis: [BITTE PRÜFEN: Preis]</li><li>Termin nach Absprache</li></ul>" }, "[BITTE PRÜFEN: Preis]")!;
  assert.equal(only.html, "<ul><li>Termin nach Absprache</li></ul>", "an emptied list item goes");
  const drop: ContentHandledQuestion = { id: price.id!, question: price.question, placeholder: price.placeholder!, block_id: "kosten", excerpt: null, scope: "seite", action: "drop", answer: null, source: "kunde" };
  const dropped = applyDrops(parseBlocksFromHtml(HTML), [drop]);
  assert.deepEqual(dropped.changed, ["kosten"]);
  assert.doesNotMatch(renderBlocksHtml(dropped.blocks), /Preis pro Stunde/);

  // The pass: phone answered in the pool → Kontaktdaten; the price dropped. Only „kosten“ and „kontakt“ change.
  const answeredPool: ContentPoolQuestion[] = [{ id: "f1", dedupe_key: "telefon", topic_key: "telefon", question: "Telefonnummer?", status: "answered", answer: "0221 98765", page_slugs: ["steuerberatung"] }];
  const passPage = pageRow({ ...waiting, state: "laeuft", job_id: JOB_ID, question_stop: { status: "answered", asked: 2, handled: [drop] } });
  const db2 = new PageDb({ dt_content_pages: [passPage as unknown as FakeRow] });
  const outcome = await runQuestionStop(db2.service as never, passPage, [], 240_000, {
    context: context({ knowledge: buildContentKnowledge({ pool: answeredPool }) }),
    now: NOW,
    models: ["claude-stub"],
    callTool: async () => ({
      json: {
        blocks: [
          { id: "kontakt", heading: "So erreichen Sie uns", level: 2, html: "<p>Rufen Sie an unter 0221 98765. Wir melden uns innerhalb eines Tages.</p>" },
          { id: "ablauf", heading: "Anders", level: 2, html: "<p>Umgeschrieben.</p>" },
        ],
      },
      usage: { inputTokens: 800, outputTokens: 60 },
      model: "claude-stub",
    }),
  });
  assert.equal(outcome.halted, false);
  const after = parseBlocksFromHtml(String(db2.page().html));
  const before = parseBlocksFromHtml(HTML);
  for (const b of before.filter((x) => x.id !== "kosten" && x.id !== "kontakt")) {
    assert.deepEqual(after.find((a) => a.id === b.id), b, `Abschnitt „${b.id}“ is restored exactly`);
  }
  assert.match(after.find((b) => b.id === "kontakt")!.html, /0221 98765/);
  assert.doesNotMatch(after.find((b) => b.id === "kosten")!.html, /BITTE PRÜFEN/);
  assert.deepEqual(after.map((b) => b.id), before.map((b) => b.id), "ids unchanged");
  assert.equal(after[0]!.heading, before[0]!.heading, "H1 unchanged");
  assert.match((db2.page().notes as string[]).join("\n"), /Keine Angabe des Kunden zu „Preis pro Stunde/, "the decision is a note for the later steps");
  assert.deepEqual(db2.page().questions, []);
  console.log("A: „Ohne Angabe weiter“ removes the sentence, answers are worked in: ok");
}

function testPassChecks() {
  const blocks = parseBlocksFromHtml(HTML);
  const answer: ContentHandledQuestion = { id: "a", question: "Preis?", placeholder: "[BITTE PRÜFEN: Preis pro Stunde]", block_id: "kosten", excerpt: null, scope: "seite", action: "answer", answer: "120 €", source: "kunde" };
  const targets = answerTargets(blocks, [answer]);
  assert.deepEqual([...targets.keys()], ["kosten"]);
  const ok = normalizeAnswersOutput({ blocks: [{ id: "kosten", heading: "Was kostet die Beratung?", level: 2, html: "<p>Die Erstberatung ist kostenlos. Danach kostet die Stunde 120 €. Sie zahlen erst nach dem Termin.</p>" }] }, { blocks, targets });
  assert.deepEqual([ok.changed, ok.fallback], [["kosten"], []]);
  const invented = normalizeAnswersOutput({ blocks: [{ id: "kosten", heading: "Was kostet die Beratung?", level: 2, html: "<p>Die Stunde kostet 120 €, Firmen zahlen 150 €.</p>" }] }, { blocks, targets });
  assert.deepEqual([invented.changed, invented.fallback, invented.rejected[0]?.reason], [[], ["kosten"], "Zahl, die weder im Abschnitt noch in einer Antwort steht"]);
  assert.match(invented.blocks.find((b) => b.id === "kosten")!.html, /Danach kostet die Stunde 120 €\./, "fallback: the placeholder swapped for the answer");
  const heading = normalizeAnswersOutput({ blocks: [{ id: "kosten", heading: "Preise", level: 2, html: "<p>120 €</p>" }] }, { blocks, targets });
  assert.equal(heading.rejected[0]?.reason, "Überschrift geändert");
  const marker = normalizeAnswersOutput({ blocks: [{ id: "kosten", heading: "Was kostet die Beratung?", level: 2, html: "<p>Die Stunde kostet [BITTE PRÜFEN: Preis pro Stunde] bzw. 120 €.</p>" }] }, { blocks, targets });
  assert.equal(marker.rejected[0]?.reason, "Platzhalter oder Marker verändert", "the answered placeholder must be gone");
  assert.equal(noNewNumbers("Wir prüfen in 5 Tagen.", "Wir prüfen in 5 Tagen, ab 120 €.", ["120 €"]), true);
  assert.equal(fillPlaceholder(blocks[2]!, "[BITTE PRÜFEN: Preis pro Stunde]", "120 € <netto>").html.includes("120 € &lt;netto&gt;"), true, "answers are escaped");
  console.log("A: the answers pass changes only the affected Abschnitte, checked in code: ok");
}

// --- rerun, stop, reset, old pages, Endabnahme, prompts ---------------------------------------------------

async function testLifecycle() {
  const stop = { status: "done" as const, handled: [] };
  assert.deepEqual(rerunPagePatch({ notes: [], freshness: EMPTY_CONTENT_FRESHNESS }, CONTENT_STEP_GEO, "kürzer").question_stop, {}, "a rerun up to the Lektorat reaches the stop again");
  assert.equal("question_stop" in rerunPagePatch({ notes: [], freshness: EMPTY_CONTENT_FRESHNESS }, CONTENT_STEP_WATERMARK, "x"), false, "from Watermark on the stop stays passed");
  assert.equal(questionStopDue(stop, [], CONTENT_STEP_WATERMARK), false);

  // Freigeben at the stop: done, no question asked again; at a „grundlegend“ halt the others wait; old pages as before.
  const now = NOW.toISOString();
  assert.deepEqual(approvalPatch({ questions: [q("A")], question_stop: { status: "waiting", handled: [] } }, now), { questions: [], question_stop: { status: "done", handled: [], at: now } });
  assert.deepEqual(approvalPatch({ questions: [q("A", { grundlegend: true }), q("B")], question_stop: { handled: [] } }, now), { questions: [q("B")] });
  assert.deepEqual(approvalPatch({ questions: [q("Alt")], question_stop: { handled: [] } }, now), { questions: [] }, "old „Braucht Sie“ pages: cleared as before");

  // An old „Braucht Sie“ page (stopped for a placeholder after a text step) is left alone by the new answers route.
  const legacy = pageRow({ state: "braucht_sie", step: CONTENT_STEP_HORMOZI, job_id: null, questions: [q("[BITTE PRÜFEN: Preis] – was soll hier stehen?", { id: "q1" })] });
  const legacyDb = new PageDb({ dt_content_pages: [legacy as unknown as FakeRow] });
  const refused = await submitContentAnswers(legacyDb.service as never, legacy, { answers: [{ id: "q1", action: "drop" }], submit: true }, USER);
  assert.ok(!refused.ok && /alten Regeln/.test(refused.message), "old pages: Freigeben or Abschnitt ändern as today");
  const review = buildReview(legacy, []);
  assert.deepEqual([review.questions.length, review.question_stop.status, review.actions.some((a) => a.kind === "approve")], [1, "none", true]);

  // Stop during the pass keeps the answers; „Weiterlaufen lassen“ runs the pass again. Reset clears the stop.
  const running = pageRow({ question_stop: { status: "answered", handled: [] } });
  const db = new PageDb({ jobs: [], dt_content_pages: [running as unknown as FakeRow], dt_content_steps: [stepRow(8)] });
  await stopContentRun(db.service as never, running, [{ step: 8, status: "done" }]);
  assert.equal(db.page().state, "in_arbeit");
  assert.equal(readQuestionStop(db.page().question_stop).status, "answered", "the decisions survive „Stoppen“");
  await resetContentPage(db.service as never, pageRow({ ...running, state: "in_arbeit" }));
  assert.deepEqual(db.page().question_stop, {}, "„Zurücksetzen“ clears the stop");

  // Endabnahme: a placeholder left is an open point, the page is „fertig“, no stop for questions again.
  const end = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, { unresolved: [], summary: "ok" }, { html: HTML, questions: [] });
  assert.deepEqual([end.pagePatch.state, (end.pagePatch.questions as unknown[]).length], ["fertig", 0]);
  assert.deepEqual((end.pagePatch.unresolved as Array<{ block_id: string }>).map((f) => f.block_id), ["kosten", "kontakt"]);

  assert.match(contentDbErrorMessage({ code: "42703", message: "column dt_content_pages.question_stop does not exist" }, "x"), /20261104_dt_content_fewer_questions\.sql/);
  assert.match(contentDbErrorMessage({ code: "PGRST205", message: "Could not find the table 'public.dt_content_org_questions' in the schema cache" }, "x"), /20261104/);
  console.log("rerun, stop, reset, old pages, Endabnahme: ok");
}

function testPromptRules() {
  const ctx = context({ stepPrompts: { seo: "Eigener SEO-Text.", faktencheck: "Eigener Faktencheck." } });
  for (const step of [CONTENT_STEP_SEO, CONTENT_STEP_FAKTENCHECK, CONTENT_STEP_GEO, CONTENT_STEP_HORMOZI, CONTENT_STEP_VERMENSCHLICHUNG, CONTENT_STEP_LEKTORAT]) {
    assert.ok(contentStepSpec(step, ctx).system.includes(QUESTION_RULES), `step ${step}: the rule is in the fixed part, also with a saved prompt`);
  }
  assert.match(QUESTION_RULES, /Sonst lässt du die Aussage weg und schreibst keinen Platzhalter/);
  assert.match(QUESTION_RULES, /Nie fragen .* Anbieterfakten, Antworten des Kunden, Kontaktdaten, Wünsche des Kunden, Anmerkungen der Redaktion/);
  const fakten = contentStepSpec(CONTENT_STEP_FAKTENCHECK, ctx);
  assert.ok(fakten.system.includes(FAKTENCHECK_QUESTION_RULES));
  const items = ((fakten.tool.input_schema as { properties: { questions: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.questions.items);
  assert.ok(["scope", "severity", "grundlegend"].every((k) => k in items.properties && items.required.includes(k)), "the model sets scope, severity, grundlegend");
  assert.doesNotMatch(contentStepSpec(CONTENT_STEP_ENDABNAHME, ctx).system, /Fragen und Platzhalter \(feste Regel\)/, "the Endabnahme asks nothing");
  console.log("prompts: the rule in the fixed part of the six steps: ok");
}

// --- found in the end-to-end runs on three pages ---------------------------------------------------

function testEndToEndFindings() {
  // A missing source is the editor's open point, never a customer question (also not at the stop).
  const src = q("Welche Quelle belegt diese Aussage?", { block_id: "ablauf", placeholder: "[QUELLE BITTE ERGÄNZEN]" });
  assert.ok(isSourceQuestion(src));
  assert.ok(isSourceQuestion(q("Welche Quelle (Studie, Leitlinie) kann für Aussagen zu Infusionen angegeben werden?")));
  assert.ok(!isSourceQuestion(q("Werden Entsorgungsnachweise ausgestellt?")));
  const withSource = renderBlocksHtml([...BLOCKS.filter((b) => b.id !== "kosten" && b.id !== "kontakt"), { id: "beleg", heading: "Quellen", level: 2, html: "<p>Laut Studie wirkt es [QUELLE BITTE ERGÄNZEN].</p>" }]);
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_FAKTENCHECK)!, { findings: [], questions: [src] }, { html: withSource });
  assert.deepEqual(patch.pagePatch.questions, [], "no page question for a source");
  assert.ok((patch.pagePatch.findings as Array<{ title: string }>).some((f) => f.title === "Quelle fehlt"), "an open point instead");
  const stopPlan = planQuestionStop({ blocks: parseBlocksFromHtml(withSource), questions: [src], knowledge: buildContentKnowledge({}), slug: "x" });
  assert.equal(questionStopOutcome(stopPlan), "go_on", "the stop does not ask for a source either");

  // The publication date some saved prompts write as a placeholder is the wanted marker [DATUM].
  const dated = withDateMarker([{ id: "stand", heading: null, level: 2, html: "<p>Zuletzt aktualisiert: [BITTE PRÜFEN: Datum der Veröffentlichung]</p>" }]);
  assert.equal(dated[0]!.html, "<p>Zuletzt aktualisiert: [DATUM]</p>");
  assert.match(QUESTION_RULES, /geht dem Text-Prompt, der Seitentyp-Vorlage und der Schrittanweisung vor/, "the rule wins over saved prompts asking for placeholders");

  // The Kontaktdaten's phone spelling: same digits in another grouping get the confirmed spelling.
  assert.equal(phoneDigits("+49 (0) 511 55 47 85 85"), "051155478585");
  assert.equal(phoneDigits("0511 / 554 785 85"), phoneDigits("0511 / 55 47 85 85"));
  const knowledge = buildContentKnowledge({ contact: contact({ telefon: "0511 / 55 47 85 85" }) });
  const spelled = withContactSpelling(
    [{ id: "kontakt", heading: "Rufen Sie an: 0511 / 554 785 85", level: 2, html: '<p>Telefon: <a href="tel:+4951155478585">0511 / 554 785 85</a>, Fax 0511 / 55 47 85 86. Oder +49 511 55478585.</p>' }],
    knowledge,
  );
  assert.equal(spelled[0]!.heading, "Rufen Sie an: 0511 / 55 47 85 85");
  assert.equal(
    spelled[0]!.html,
    '<p>Telefon: <a href="tel:+4951155478585">0511 / 55 47 85 85</a>, Fax 0511 / 55 47 85 86. Oder 0511 / 55 47 85 85.</p>',
    "text only (the tel: link keeps its form), another number stays",
  );
  const viaStep = stepPatchFor(
    contentStepDefinition(CONTENT_STEP_LEKTORAT)!,
    { blocks: [...BLOCKS.filter((b) => b.id !== "kosten" && b.id !== "kontakt"), { id: "kontakt", heading: null, level: 2, html: "<p>Rufen Sie an: 0511 / 554 785 85.</p>" }], title: "T", meta_description: "M", questions: [] },
    { html: HTML, knowledge },
  );
  assert.match(String(viaStep.pagePatch.html), /0511 \/ 55 47 85 85/, "applied to every text step's output");

  // Soft hyphens of a copied company name are no part of the value.
  const shy = contact({ firmenname: "Rechts\u00adanwalts\u00adkanzlei DIEL" });
  assert.equal(contactFieldText(shy, "firmenname"), "Rechtsanwaltskanzlei DIEL");
  assert.equal(contactPromptData(shy)!.lines[0]!.value, "Rechtsanwaltskanzlei DIEL");

  // Page questions over the limit are never asked: once the stop is passed their sentences go.
  const blocks: ContentTextBlock[] = [
    { id: "h1", heading: "Seite", level: 1, html: "" },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, heading: `Abschnitt ${n}`, level: 2 as const, html: `<p>Satz eins. Wert ${n}: [BITTE PRÜFEN: Angabe ${n}]. Satz drei.</p>` })),
  ];
  const five = planQuestionStop({ blocks, questions: [], knowledge: buildContentKnowledge({}), slug: "x" });
  assert.deepEqual([five.ask.length, five.overflow.length], [3, 2]);
  const decided = five.ask.map((a): ContentHandledQuestion => ({ id: a.id!, question: a.question, placeholder: a.placeholder ?? null, block_id: a.block_id ?? null, excerpt: null, scope: "seite", action: "drop", answer: null, source: "kunde" }));
  const answered = planQuestionStop({ blocks, questions: five.ask, knowledge: buildContentKnowledge({}), decisions: decided, slug: "x" });
  const items = questionStopPassItems(answered);
  assert.equal(items.length, 5);
  assert.deepEqual(items.filter((i) => i.source === "offen").map((i) => [i.action, i.placeholder]), five.overflow.map((o) => ["drop", o.placeholder]), "the two unasked ones are dropped");
  assert.doesNotMatch(renderBlocksHtml(applyDrops(blocks, items).blocks), /BITTE PRÜFEN/, "no placeholder of an unasked question stays");
  assert.equal(readQuestionStop({ handled: [{ ...items[4], source: "offen" }] }).handled[0]!.source, "offen");
  console.log("end-to-end findings: sources, date, phone spelling, soft hyphens, unasked placeholders: ok");
}

async function main() {
  testTopicsAndSuppression();
  testLimitAndOverflow();
  await testPool();
  testNoHaltInSteps();
  testGrundlegend();
  testStopIsDue();
  await testStopInTheLoop();
  await testStopAsksOnce();
  await testAnswerAndDrop();
  testPassChecks();
  await testLifecycle();
  testPromptRules();
  testEndToEndFindings();
  console.log("OK: fewer questions tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
