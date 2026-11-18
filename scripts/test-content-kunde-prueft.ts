/**
 * Texte: „KUNDE PRÜFT“. An answer or a note of the editors that says the customer is still
 * checking a point is no fact: its wording never goes into the text. At the point the question is
 * about the text gets [BITTE PRÜFEN: <the open question in one sentence>], the later steps leave
 * that placeholder as it is, and the Faktencheck (or the stop) does not ask the question again.
 * No network, no model.
 * Run: npm run test:content-kunde-prueft
 */
import assert from "node:assert/strict";

import { customerAnswersFromPool } from "../lib/dt/content/org-questions";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { normalizeAnswersOutput, type AnswersPassResult } from "../lib/dt/content/pipeline/answers";
import { contentGapQuestions } from "../lib/dt/content/pipeline/gaps";
import {
  contentPendingChecks,
  dropStructuralPlaceholders,
  isKundePrueft,
  isStructuralPoint,
  keepPendingPlaceholders,
  kundePrueftNoteLine,
  kundePrueftQuestionsInNotes,
  kundePrueftPlaceholder,
  pendingCheck,
  pendingChecksBlock,
} from "../lib/dt/content/pipeline/kunde-prueft";
import { QUESTION_RULES, contentStepSpec, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { planQuestionStop } from "../lib/dt/content/pipeline/question-stop";
import {
  buildContentKnowledge,
  contentQuestionId,
  customerAnswerNote,
  knownAnswerFor,
  planContentQuestions,
  type ContentPoolQuestion,
} from "../lib/dt/content/pipeline/questions";
import { CONTENT_STEP_FAKTENCHECK, CONTENT_STEPS } from "../lib/dt/content/pipeline/steps";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentTextBlock } from "../lib/dt/content/render";
import type { ContentQuestion } from "../lib/dt/content/types";

const QUESTION = "Gibt es eine schriftliche Einzelaufstellung pro Uhr?";
const PLACEHOLDER = "[BITTE PRÜFEN: Gibt es eine schriftliche Einzelaufstellung pro Uhr?]";

// --- recognising „KUNDE PRÜFT“ -----------------------------------------------------------------
{
  for (const yes of ["KUNDE PRÜFT", "Kunde prüft", "kunde prueft noch", "Der Kunde prüft das noch.", "wird vom Kunden geprüft", "Kundin klärt das intern", "prüft der Kunde", "Kunde prüft – bitte warten"]) {
    assert.equal(isKundePrueft(yes), true, yes);
  }
  for (const no of [
    "Der Kunde prüft jedes Stück selbst vor dem Kauf.",
    "Ja, pro Uhr gibt es eine schriftliche Aufstellung.",
    "Kunde prüft bis 15.11.",
    "Wir prüfen jede Uhr kostenlos.",
    "Keine Angabe",
    "",
    null,
  ]) {
    assert.equal(isKundePrueft(no), false, String(no));
  }
  assert.equal(kundePrueftPlaceholder(QUESTION), PLACEHOLDER);
  assert.equal(kundePrueftPlaceholder("Welche Marken? Und welche nicht?"), "[BITTE PRÜFEN: Welche Marken?]", "one sentence");
  console.log("recognition: ok");
}

// --- the fixed rule -------------------------------------------------------------------------------
{
  assert.ok(
    QUESTION_RULES.includes(
      "Lautet eine Antwort oder Anmerkung der Redaktion ‚KUNDE PRÜFT‘ (auch sinngemäß), wird an der passenden Stelle ein Platzhalter [BITTE PRÜFEN: <die offene Frage in einem Satz>] gesetzt. Der Wortlaut der Anmerkung kommt nie in den Text.",
    ),
  );
  assert.match(QUESTION_RULES, /bleibt in jedem späteren Schritt unverändert stehen, und zu ihm wird keine neue Frage gestellt/);
  console.log("rule: ok");
}

// --- knowledge: no fact, no value, no confirmed answer ----------------------------------------------
const pool: ContentPoolQuestion[] = [
  { id: "p1", dedupe_key: "k1", topic_key: null, question: QUESTION, status: "answered", answer: "KUNDE PRÜFT", page_slugs: ["uhren"] },
  { id: "p2", dedupe_key: "telefon", topic_key: "telefon", question: "Welche Telefonnummer?", status: "answered", answer: "Kunde prüft noch", page_slugs: ["uhren"] },
  { id: "p3", dedupe_key: "k3", topic_key: null, question: "Werden Uhren mit Box angekauft?", status: "answered", answer: "Ja, mit und ohne Box.", page_slugs: ["uhren"] },
];
const knowledge = buildContentKnowledge({
  pool,
  notes: [customerAnswerNote("Können Miterben per Video zugeschaltet werden?", "KUNDE PRÜFT")],
});
{
  assert.deepEqual(knowledge.pending.map((p) => p.question), [QUESTION, "Welche Telefonnummer?", "Können Miterben per Video zugeschaltet werden?"]);
  assert.equal(knowledge.values.telefon, undefined, "„Kunde prüft noch“ is no phone number");
  assert.ok(!knowledge.answered.some((a) => /prüft/i.test(a.answer ?? "")), "and no earlier answer");
  assert.deepEqual(customerAnswersFromPool(pool), [{ question: "Werden Uhren mit Box angekauft?", answer: "Ja, mit und ohne Box." }], "not a confirmed answer of the customer");
  console.log("knowledge: ok");
}

// --- every step sees the open checks, never „KUNDE PRÜFT“ as a fact --------------------------------
const blocks: ContentTextBlock[] = [
  { id: "intro", heading: "Luxusuhren verkaufen", level: 1, html: "<p>Einstieg.</p>" },
  { id: "ablauf", heading: "Ablauf", level: 2, html: `<p>Sie schicken Fotos. ${PLACEHOLDER}</p>` },
  { id: "preis", heading: "Preis", level: 2, html: "<p>Fester Preis, sofortige Zahlung.</p>" },
];
const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Kolb & Sartor",
  page: {
    name: "Luxus-Uhren Ankauf", path: "/uhren", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Ankauf von Luxusuhren." }],
  settings: { anrede: "Sie", branche: "Handel", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks,
  title: null,
  metaDescription: null,
  customerAnswers: customerAnswersFromPool(pool),
  pendingChecks: knowledge.pending,
  knowledge,
  ...patch,
});
{
  const block = pendingChecksBlock(knowledge.pending);
  assert.match(block, /^### Offen – der Kunde prüft noch \(KUNDE PRÜFT\)/);
  assert.ok(block.includes(`- ${QUESTION} → ${PLACEHOLDER}`));
  assert.equal(pendingChecksBlock([]), "");
  for (const def of CONTENT_STEPS.filter((d) => d.provider === "anthropic" && d.key !== "aktualitaet")) {
    const user = contentStepSpec(def.step, context()).user;
    assert.ok(user.includes(PLACEHOLDER), `${def.name} knows the placeholder`);
    assert.ok(!user.includes(`→ KUNDE PRÜFT`) && !user.includes("→ Kunde prüft noch"), `${def.name}: no „KUNDE PRÜFT“ as an answer`);
  }
  console.log("prompts: ok");
}

// --- the later steps leave the placeholder as it is --------------------------------------------------
{
  const rewritten: ContentTextBlock[] = [
    { ...blocks[0]! },
    { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>Sie schicken Fotos, wir melden uns.</p>" },
    { ...blocks[2]! },
  ];
  const kept = keepPendingPlaceholders(rewritten, blocks, knowledge.pending);
  assert.deepEqual(kept.restored, [PLACEHOLDER]);
  assert.equal(kept.blocks[1]!.html, `<p>Sie schicken Fotos, wir melden uns.</p>\n<p>${PLACEHOLDER}</p>`, "back in its own Abschnitt");
  assert.deepEqual(keepPendingPlaceholders(blocks, blocks, knowledge.pending).restored, [], "kept by the step: nothing to do");
  // The Abschnitt is gone: the placeholder goes to the end of the text.
  const gone = keepPendingPlaceholders([rewritten[0]!, rewritten[2]!], blocks, knowledge.pending);
  assert.ok(gone.blocks[1]!.html.endsWith(`<p>${PLACEHOLDER}</p>`));
  // Only „KUNDE PRÜFT“ placeholders are restored; others may go as before.
  const other = [{ ...blocks[1]!, html: "<p>[BITTE PRÜFEN: Öffnungszeiten am Samstag]</p>" }];
  assert.deepEqual(keepPendingPlaceholders([{ ...other[0]!, html: "<p>Samstags geöffnet.</p>" }], other, knowledge.pending).restored, []);
  console.log("placeholder kept: ok");
}

// --- the Faktencheck asks nothing about it --------------------------------------------------------
{
  const modelQuestion: ContentQuestion = { kind: "fact", question: "Gibt es pro Uhr eine schriftliche Einzelaufstellung?", block_id: "ablauf", blocking: true, scope: "seite", severity: "high" };
  const other: ContentQuestion = { kind: "fact", question: "Wie lange dauert die Auszahlung?", block_id: "preis", blocking: true, scope: "seite", severity: "medium" };
  const candidates = contentGapQuestions(blocks, [modelQuestion, other]);
  const plan = planContentQuestions({ candidates, knowledge, blocks, step: CONTENT_STEP_FAKTENCHECK });
  assert.deepEqual(plan.page.map((q) => q.question), ["Wie lange dauert die Auszahlung?"], "neither the model's question nor the placeholder's");
  assert.ok(plan.suppressed.some((s) => s.reason === "Kunde prüft (KUNDE PRÜFT), Platzhalter bleibt"));
  assert.deepEqual(knownAnswerFor({ kind: "missing", question: "x", placeholder: PLACEHOLDER, blocking: true }, knowledge), { action: "pending", source: "kunde_prueft" });
  console.log("Faktencheck: ok");
}

// --- the stop: not asked, nothing worked in; „KUNDE PRÜFT“ typed at the stop -----------------------
{
  const stop = planQuestionStop({ blocks, questions: [], knowledge, slug: "uhren" });
  assert.equal(stop.ask.length, 0);
  assert.equal(stop.handled.length, 0, "the placeholder is not dropped and not answered");

  // The editor answers „KUNDE PRÜFT“ at the stop.
  const fresh = buildContentKnowledge({ pool: [] });
  const gap = contentGapQuestions(blocks)[0]!;
  const gapId = contentQuestionId(gap);
  const onPlaceholder = planQuestionStop({
    blocks, questions: [], knowledge: fresh, slug: "uhren",
    decisions: [{ id: gapId, question: gap.question, placeholder: PLACEHOLDER, block_id: "ablauf", excerpt: null, scope: "seite", action: "answer", answer: "KUNDE PRÜFT", source: "kunde" }],
  });
  assert.equal(onPlaceholder.handled.length, 0, "a placeholder in the text stays as it is");

  // A question about a statement (no placeholder yet): the pass sets the placeholder, not the words.
  const statement: ContentQuestion = { kind: "fact", question: "Wie schnell antwortet Daniel Sartor auf Fotos?", block_id: "preis", excerpt: "Fester Preis, sofortige Zahlung.", blocking: true, scope: "seite", severity: "medium" };
  const sid = contentQuestionId(statement);
  const onStatement = planQuestionStop({
    blocks, questions: [{ ...statement, id: sid }], knowledge: fresh, slug: "uhren",
    decisions: [{ id: sid, question: statement.question, placeholder: null, block_id: "preis", excerpt: statement.excerpt!, scope: "seite", action: "answer", answer: "Kunde prüft", source: "kunde" }],
  });
  const set = kundePrueftPlaceholder(statement.question);
  assert.deepEqual(onStatement.handled.map((h) => [h.action, h.answer]), [["answer", set]]);

  // The pass accepts a version that adds exactly that placeholder, and nothing else changed.
  const targets = new Map([["preis", onStatement.handled]]);
  const model = { blocks: [{ id: "preis", heading: "Preis", level: 2, html: `<p>Fester Preis, sofortige Zahlung. ${set}</p>` }] };
  const result: AnswersPassResult = normalizeAnswersOutput(model, { blocks, targets });
  assert.deepEqual([result.changed, result.rejected], [["preis"], []]);
  assert.ok(result.blocks[2]!.html.includes(set) && !/KUNDE PRÜFT|Kunde prüft/.test(result.blocks[2]!.html.replace(set, "")));
  console.log("stop: ok");
}

// --- the stop's note feeds the later steps the same way -------------------------------------------
{
  assert.equal(pendingCheck(QUESTION).placeholder, PLACEHOLDER);
  const fromNote = buildContentKnowledge({ notes: [customerAnswerNote(QUESTION, "KUNDE PRÜFT")] });
  assert.deepEqual(fromNote.pending.map((p) => p.placeholder), [PLACEHOLDER]);
  console.log("notes: ok");
}

console.log("OK: KUNDE PRÜFT tests passed");

// --- Struktur-Befunde: no placeholder, nothing put back ---------------------------------------------
{
  for (const yes of ["Quelle fehlt", "Quellen-Abschnitt fehlt (YMYL)", "H1 fehlt", "Einleitung zu lang", "Interne Verlinkung auf das Hauptsilo fehlt", "FAQ-Abschnitt doppelt", "Meta-Description fehlt"]) {
    assert.equal(isStructuralPoint(yes), true, yes);
  }
  for (const no of [QUESTION, "Preis fehlt", "Öffnungszeiten am Samstag unbelegt", "Gibt es eine Quelle für die Erfolgsquote?", "Garantie von 5 Jahren nicht belegt", "Wartezeit auf einen Termin fehlt", "", null]) {
    assert.equal(isStructuralPoint(no), false, String(no));
  }

  // A „KUNDE PRÜFT“ note of a Struktur-Befund is no open check: not in the prompts, not marked, not put back.
  const structuralNote = kundePrueftNoteLine("Quelle fehlt");
  const k = buildContentKnowledge({ notes: [structuralNote, kundePrueftNoteLine(QUESTION)] });
  assert.deepEqual(k.pending.map((p) => p.question), [QUESTION]);
  assert.deepEqual(kundePrueftQuestionsInNotes([structuralNote, kundePrueftNoteLine(QUESTION)]), [QUESTION]);
  const mixed = [pendingCheck("Quelle fehlt"), pendingCheck(QUESTION)];
  assert.deepEqual(contentPendingChecks(mixed).map((p) => p.question), [QUESTION]);
  assert.ok(!pendingChecksBlock(mixed).includes("Quelle fehlt"));

  const before: ContentTextBlock[] = [{ id: "a", heading: "A", level: 2, html: `<p>Text.</p>\n<p>[BITTE PRÜFEN: Quelle fehlt]</p>\n<p>${PLACEHOLDER}</p>` }];
  const after: ContentTextBlock[] = [{ id: "a", heading: "A", level: 2, html: "<p>Text neu.</p>" }];
  const kept = keepPendingPlaceholders(after, before, mixed);
  assert.deepEqual(kept.restored, [PLACEHOLDER], "only the real question comes back");
  assert.ok(!kept.blocks[0]!.html.includes("Quelle fehlt"));

  // The code's own paragraph of a Struktur-Befund goes; a real question and a placeholder inside a sentence stay.
  const cleaned = dropStructuralPlaceholders([
    ...before,
    { id: "b", heading: "B", level: 2, html: "<p>Laut Studie [BITTE PRÜFEN: Quelle fehlt] sinkt das Risiko.</p>\n<p>[BITTE PRÜFEN: Quellen-Abschnitt fehlt (YMYL)]</p>" },
  ]);
  assert.deepEqual(cleaned.dropped, ["[BITTE PRÜFEN: Quelle fehlt]", "[BITTE PRÜFEN: Quellen-Abschnitt fehlt (YMYL)]"]);
  assert.equal(cleaned.blocks[0]!.html, `<p>Text.</p>\n<p>${PLACEHOLDER}</p>`);
  assert.equal(cleaned.blocks[1]!.html, "<p>Laut Studie [BITTE PRÜFEN: Quelle fehlt] sinkt das Risiko.</p>");
  console.log("Struktur-Befunde: ok");
}
