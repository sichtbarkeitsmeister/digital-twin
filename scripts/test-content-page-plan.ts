/**
 * Texte: Seitenkonzept und Themenplan. The Analyse decides per page who searches it and which
 * 4–6 topics it covers; the page window shows and changes both; every later step gets them; the
 * page can wait after the Analyse for the editors. No network, no model.
 * Run: npm run test:content-page-plan
 */
import assert from "node:assert/strict";

import { themenplanFromText, themenplanToText } from "../components/dt/content/dt-content-page-plan";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { parseContentPagePatch } from "../lib/dt/content/page-patch";
import {
  PAGE_PLAN_RULES_CHECK,
  PAGE_PLAN_RULES_REWRITE,
  PAGE_PLAN_RULES_SEO,
  hasPagePlan,
  normalizeSeitenkonzept,
  normalizeThemenplan,
  pagePlanBlock,
  readPagePlan,
  withEditedPagePlan,
} from "../lib/dt/content/pipeline/page-plan";
import { contentStepSpec, normalizeAnalyse, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { questionStopKeep, readQuestionStop } from "../lib/dt/content/pipeline/question-stop";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import {
  CONTENT_STEPS,
  CONTENT_STEP_ANALYSE,
  CONTENT_STEP_ENDABNAHME,
  CONTENT_STEP_FAKTENCHECK,
  CONTENT_STEP_SEO,
  contentStepDefinition,
} from "../lib/dt/content/pipeline/steps";
import { pageDetail, reviewPagePlan, type ContentPageRow, type ContentStepRow } from "../lib/dt/content/store";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const KONZEPT = {
  wer_sucht: "Menschen, deren Blutbild unauffällig ist und die trotzdem seit Monaten müde sind.",
  ziel: "Wissen, welche Werte ein großes Blutbild nicht zeigt.",
  unklar_und_sorgen: "Ob sich eine weitere Untersuchung lohnt oder wieder nichts herauskommt.",
  entscheidungswissen: "Welche Laborwerte zusätzlich geprüft werden und was das bedeutet.",
  fakten: "Erstgespräch 60 Minuten; Labor im Haus",
  abgrenzung: "Erklärt nur die Laborwerte; die Behandlung steht auf der Seite Infusionen.",
};
const THEMEN = [
  { thema: "Ferritin und Eisen", inhalt: "Warum der Hb-Wert allein nicht reicht.", quelle: "Analyse" },
  { thema: "Schilddrüse", inhalt: "TSH, fT3 und fT4 im Zusammenhang.", quelle: "Excel" },
  { thema: "Vitamin D und B12", inhalt: "Wann ein Mangel müde macht.", quelle: "Analyse" },
  { thema: "Ablauf der Blutabnahme", inhalt: "Nüchtern, 15 Minuten, Ergebnis nach einer Woche.", quelle: "Excel" },
];
const ANALYSE = {
  main_keyword: "Blutwerte Erschöpfung",
  main_question: "Welche Blutwerte erklären Erschöpfung?",
  seitenkonzept: KONZEPT,
  themenplan: THEMEN,
  fanout_questions: [],
  deferred_questions: [],
  dropped_questions: [],
  hormozi: { traumziel: "Endlich einen Wert in der Hand, der die Müdigkeit erklärt.", hauptschmerz: "Alle Werte „in Ordnung“ und trotzdem erschöpft.", groesste_huerde: "Noch eine Untersuchung ohne Ergebnis.", einwaende: ["Mein Hausarzt hat schon alles geprüft."], moeglicher_beweis: "kein belegter Beweis", gewuenschter_cta: "Termin" },
  usable_facts: [],
  missing_facts: [],
  assumptions: [],
};

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Praxis Lindner",
  page: {
    name: "Blutwerte", path: "/erschoepfung/blutwerte", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: "Erschöpfung", estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: "Themen: Schilddrüse, Ablauf der Blutabnahme", internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "leistungen", label: "Leistungen", current: "Labordiagnostik im Haus. Erstgespräch 60 Minuten." }],
  settings: { anrede: "Sie", branche: "Heilpraktiker", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: { name: "Sabine", role: "Wunschkundin", beschreibung: "Seit Monaten erschöpft, Blutwerte unauffällig." },
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: { [CONTENT_STEP_ANALYSE]: ANALYSE },
  blocks: [{ id: "h1", heading: "Blutwerte bei Erschöpfung", level: 1, html: "<p>Text.</p>" }],
  title: null,
  metaDescription: null,
  ...patch,
});

{
  // The Analyse is asked for both, and for Hormozi parts of this page instead of the Avatar alone.
  const spec = contentStepSpec(CONTENT_STEP_ANALYSE, context({ outputs: {} }));
  assert.match(spec.system, /seitenkonzept: das Konzept GENAU dieser Seite/);
  assert.match(spec.system, /themenplan: 4–6 Themen/);
  assert.match(spec.system, /Nennt der KI-Prompt der Redaktion für diese Seite \(„Themen und Hinweise für den Texter“ aus der Seitenstruktur\) Themen, haben diese Vorrang/);
  assert.match(spec.system, /nicht aus dem Avatar allein/);
  assert.ok(!/nur aus dem Avatar\)/.test(spec.system), "the objections no longer come from the Avatar alone");
  const schema = spec.tool.input_schema as { properties: Record<string, unknown>; required: string[] };
  assert.ok(schema.properties.seitenkonzept && schema.properties.themenplan);
  assert.ok(schema.required.includes("seitenkonzept") && schema.required.includes("themenplan"));
  const keys = Object.keys(schema.properties);
  assert.ok(keys.indexOf("seitenkonzept") < keys.indexOf("fanout_questions") && keys.indexOf("themenplan") < keys.indexOf("hormozi"), "the concept comes before the details that build on it");
  assert.match(spec.user, /KI-Prompt der Redaktion[\s\S]*Themen: Schilddrüse, Ablauf der Blutabnahme/, "the Excel topics are in front of the model");
  console.log("Analyse prompt: ok");
}

{
  // What the model sends is cleaned: topics from the Excel first, each once, at most six.
  const out = normalizeAnalyse({ ...ANALYSE, themenplan: [...THEMEN, { thema: "schilddrüse", inhalt: "doppelt", quelle: "Analyse" }, "Kosten", { thema: "Fünf" }, { thema: "Sechs" }, { thema: "Sieben" }] }, context());
  assert.deepEqual(out.themenplan!.map((t) => t.thema), ["Schilddrüse", "Ablauf der Blutabnahme", "Ferritin und Eisen", "Vitamin D und B12", "Kosten", "Fünf"]);
  assert.deepEqual(out.themenplan!.slice(0, 2).map((t) => t.quelle), ["Excel", "Excel"]);
  assert.equal(out.seitenkonzept!.wer_sucht, KONZEPT.wer_sucht);
  assert.equal(normalizeSeitenkonzept({ fakten: ["Labor im Haus", "60 Minuten"] })!.fakten, "Labor im Haus; 60 Minuten", "a list of facts is read too");
  assert.equal(normalizeSeitenkonzept({}), null);
  assert.deepEqual(normalizeThemenplan(null), []);
  // An older Analyse (before this existed): no plan, nothing breaks.
  const old = normalizeAnalyse({ main_keyword: "x", hormozi: {} }, context());
  assert.equal(hasPagePlan(readPagePlan(old)), false);
  console.log("normalisation: ok");
}

{
  // Every later step gets the plan; SEO as part of the Analyse, the others as their own block.
  const block = pagePlanBlock(ANALYSE);
  assert.match(block, /^## Seitenkonzept und Themenplan \(aus der Analyse; verbindlich für diese Seite\)/);
  assert.match(block, /Wer sucht genau diese Leistung und warum\? Menschen, deren Blutbild unauffällig ist/);
  assert.match(block, /Themenplan \(in dieser Reihenfolge\):\n1\. Schilddrüse – TSH, fT3 und fT4 im Zusammenhang\. \(Excel\)/);
  assert.match(block, /Für genau diese Seite \(nicht die allgemeine Lage des Avatars\):\nTraumziel: Endlich einen Wert/);
  assert.equal(pagePlanBlock({ main_keyword: "x" }), "", "no plan, no block");

  const ctx = context();
  for (const def of CONTENT_STEPS.filter((d) => d.provider === "anthropic" && d.step > CONTENT_STEP_ANALYSE && d.key !== "aktualitaet")) {
    const spec = contentStepSpec(def.step, ctx);
    assert.ok(spec.user.includes("Ferritin und Eisen") && spec.user.includes(KONZEPT.abgrenzung), `${def.name} sees the plan`);
    const rule = def.step === CONTENT_STEP_SEO ? PAGE_PLAN_RULES_SEO : def.step === CONTENT_STEP_FAKTENCHECK || def.step === CONTENT_STEP_ENDABNAHME ? PAGE_PLAN_RULES_CHECK : PAGE_PLAN_RULES_REWRITE;
    assert.ok(spec.system.includes(rule), `${def.name} has its fixed plan rule`);
  }
  // Without a plan the prompts are the ones of before: no rule, no block.
  const bare = context({ outputs: { [CONTENT_STEP_ANALYSE]: { main_keyword: "x" } } });
  for (const def of CONTENT_STEPS.filter((d) => d.provider === "anthropic" && d.step > CONTENT_STEP_ANALYSE && d.key !== "aktualitaet")) {
    const spec = contentStepSpec(def.step, bare);
    assert.ok(!spec.system.includes("Seitenkonzept und Themenplan (feste Regel)") && !spec.user.includes("## Seitenkonzept und Themenplan"), `${def.name}: unchanged without a plan`);
  }
  console.log("later steps: ok");
}

{
  // The editors' change replaces the Analyse's plan and is marked; the rest of the output stays.
  const edited = withEditedPagePlan(ANALYSE, {
    seitenkonzept: { ...KONZEPT, ziel: "Wissen, ob ein erweitertes Labor sinnvoll ist." },
    themenplan: themenplanFromText("Schilddrüse – TSH im Zusammenhang\n2. Kosten: was das erweiterte Labor kostet\n- Nachbesprechung", THEMEN as never),
  });
  const plan = readPagePlan(edited);
  assert.equal(plan.edited, true);
  assert.equal(plan.seitenkonzept!.ziel, "Wissen, ob ein erweitertes Labor sinnvoll ist.");
  assert.deepEqual(plan.themenplan, [
    { thema: "Schilddrüse", inhalt: "TSH im Zusammenhang", quelle: "Excel" },
    { thema: "Kosten", inhalt: "was das erweiterte Labor kostet", quelle: "Redaktion" },
    { thema: "Nachbesprechung", inhalt: "", quelle: "Redaktion" },
  ]);
  assert.equal((edited as { main_question: string }).main_question, ANALYSE.main_question);
  assert.match(pagePlanBlock(edited), /aus der Analyse, von der Redaktion bearbeitet/);
  assert.equal(themenplanToText(plan.themenplan), "Schilddrüse – TSH im Zusammenhang\nKosten – was das erweiterte Labor kostet\nNachbesprechung");
  const patch = parseContentPagePatch({ organisationId: "11111111-1111-4111-8111-111111111111", page_plan: { themenplan: [{ thema: "Kosten" }] } });
  assert.equal(patch.ok, true, "the page window may send the plan");
  assert.equal(parseContentPagePatch({ organisationId: "11111111-1111-4111-8111-111111111111", analyse_stop: true }).ok, true);
  console.log("editing: ok");
}

{
  // „Nach der Analyse zur Durchsicht anhalten“: off by default, kept by a reset, halts after step 1.
  const def = contentStepDefinition(CONTENT_STEP_ANALYSE)!;
  const through = stepPatchFor(def, ANALYSE, { html: "" });
  assert.deepEqual([through.stepStatus, through.halted, through.pagePatch.state], ["done", false, undefined]);
  const stop = readQuestionStop({ analyse_stop: true });
  assert.equal(stop.analyse_stop, true);
  assert.equal(readQuestionStop({}).analyse_stop, undefined);
  assert.deepEqual(questionStopKeep(stop), { analyse_stop: true });
  const halted = stepPatchFor(def, ANALYSE, { html: "", question_stop: stop });
  assert.deepEqual([halted.stepStatus, halted.halted, halted.pagePatch.state, halted.pagePatch.job_id], ["waiting", true, "braucht_sie", null]);

  const row = (step: number, status: string, output: unknown): ContentStepRow =>
    ({ id: `s${step}`, page_id: "p", organisation_id: "o", step, name: "", status, output, model: null, input_tokens: 0, output_tokens: 0, cost_eur: 0, error: null, started_at: null, finished_at: null, approved_by: null, approved_at: null }) as ContentStepRow;
  const waitingPage = { state: "braucht_sie", step: CONTENT_STEP_ANALYSE, question_stop: stop } as unknown as ContentPageRow;
  const review = reviewPagePlan(waitingPage, [row(CONTENT_STEP_ANALYSE, "waiting", ANALYSE)]);
  assert.deepEqual([review.stop_enabled, review.waiting, review.available, review.editable, review.text_written], [true, true, true, true, false]);
  assert.equal(review.themenplan.length, 4);
  assert.equal(pageDetail({ ...waitingPage, questions: [] } as unknown as ContentPageRow), "Analyse fertig – Seitenkonzept und Themenplan prüfen, dann „Freigeben“");
  const running = reviewPagePlan({ state: "laeuft", step: 4, question_stop: {} } as unknown as ContentPageRow, [row(CONTENT_STEP_ANALYSE, "done", ANALYSE), row(CONTENT_STEP_SEO, "done", {})]);
  assert.deepEqual([running.editable, running.text_written, running.stop_enabled], [false, true, false], "not while the page runs");
  const fresh = reviewPagePlan({ state: "nicht_begonnen", step: null, question_stop: {} } as unknown as ContentPageRow, []);
  assert.deepEqual([fresh.analysed, fresh.available, fresh.editable], [false, false, false]);
  console.log("stop after the Analyse and review: ok");
}

console.log("OK: content page plan tests passed");
