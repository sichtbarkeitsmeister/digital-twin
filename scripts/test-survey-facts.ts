/**
 * Stufe-1 survey facts: extraction + coverage heuristics.
 * Run: npm run test:survey-facts
 */
import assert from "node:assert/strict";

import {
  checkSurveyFactsCoverage,
  extractSurveyFacts,
  formatFactsForCoverageRepair,
  formatSurveyFactsForAgentContext,
  summarizeSurveyFactCoverage,
  unresolvedSurveyFactCoverageIds,
} from "../lib/dt/survey-facts";
import { buildSurveyResponseContextForAgent } from "../lib/dt/survey-to-agent-context";

const rankingOptions = [
  { id: "o1", label: "Option A" },
  { id: "o2", label: "Option B" },
  { id: "o3", label: "5,0 Sterne / 171 Bewertungen" },
];

const definition = {
  steps: [
    {
      id: "s1",
      title: "Block 1",
      description: "",
      fields: [
        {
          id: "f1",
          type: "text" as const,
          title: "Wie lange dauert es von der ersten Anfrage bis zum Auftrag?",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f2",
          type: "ranking" as const,
          title: "Auslöser für den Anruf",
          description: "",
          required: false,
          options: rankingOptions,
        },
        {
          id: "f3",
          type: "text" as const,
          title: "Avatar-Name",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f4",
          type: "text" as const,
          title: "Nur mit Bemerkung",
          description: "",
          required: false,
          options: [],
        },
      ],
    },
  ],
};

const answers = {
  f1: "1–3 Wochen",
  f3: "Alex Müller",
};

const fieldQuestions = [
  {
    id: "q1",
    field_id: "f4",
    kind: "remark",
    question: "Kunde wirkte gestresst",
    answer: null,
  },
];

const bundle = extractSurveyFacts({
  surveyTitle: "Einfach Entrümpelung Düsseldorf",
  definition,
  answers,
  fieldQuestions,
});

assert.equal(bundle.facts.length, 3);
assert.equal(bundle.skippedFieldCount, 1);
assert.equal(bundle.facts[0]?.id, "fact_001");
assert.match(bundle.facts[0]?.value ?? "", /1–3 Wochen/);
assert.equal(bundle.facts[1]?.value, "Alex Müller");
assert.equal(bundle.facts[2]?.kind, "remark");
assert.doesNotMatch(bundle.facts.map((f) => f.fieldTitle).join("|"), /Auslöser/);

const formatted = formatSurveyFactsForAgentContext(bundle);
assert.match(formatted, /Pflicht-Checkliste/);
assert.match(formatted, /fact_001/);
assert.match(formatted, /fact_002/);
assert.match(formatted, /fact_003/);
assert.match(formatted, /1–3 Wochen/);
assert.doesNotMatch(formatted, /5,0 Sterne \/ 171 Bewertungen/);

const viaCompat = buildSurveyResponseContextForAgent({
  surveyTitle: "Einfach Entrümpelung Düsseldorf",
  definition,
  answers,
  fieldQuestions,
});
assert.match(viaCompat, /fact_001/);

const covered = checkSurveyFactsCoverage({
  facts: bundle.facts,
  texts: [
    "Die Persona Alex Müller braucht 1–3 Wochen. Kunde wirkte gestresst.",
  ],
});
assert.equal(covered.missing.length, 0);
assert.ok(covered.covered.length >= 2);

const missing = checkSurveyFactsCoverage({
  facts: bundle.facts,
  texts: ["Eine Persona ohne konkrete Angaben."],
});
assert.ok(missing.missing.length >= 2);

/** Paraphrase with distinctive terms should count as covered, not weak. */
const paraphraseFact = {
  id: "fact_p1",
  fieldId: "fp",
  fieldTitle: "Einwände",
  fieldType: "text",
  fieldDescription: null,
  stepTitle: "Verkauf",
  kind: "answer" as const,
  label: "Einwände",
  value: "Was kostet mich das? Lohnt sich das — oder ist der Aufwand größer als der Nutzen?",
};
const paraphraseCovered = checkSurveyFactsCoverage({
  facts: [paraphraseFact],
  texts: [
    "Deine häufigsten Einwände: Du fragst zuerst was es kostet, dann ob sich der Aufwand lohnt und größer ist als der Nutzen.",
  ],
});
assert.equal(paraphraseCovered.covered.length, 1);
assert.equal(paraphraseCovered.weak.length, 0);

/** Cross-ref placeholders must not create false missing/weak noise. */
const crossRefFact = {
  id: "fact_x1",
  fieldId: "fx",
  fieldTitle: "Mandatsreise",
  fieldType: "textarea",
  fieldDescription: null,
  stepTitle: "Reise",
  kind: "answer" as const,
  label: "Mandatsreise",
  value: "Ist die gleiche wie beim Arbeitgeber. Bitte dort übernehmen.",
};
const crossRefReport = checkSurveyFactsCoverage({
  facts: [crossRefFact],
  texts: ["Persona ohne den Verweis-Wortlaut."],
});
assert.equal(crossRefReport.covered.length, 1);
assert.equal(crossRefReport.covered[0]?.matchedBy, "cross_ref_placeholder");
assert.equal(crossRefReport.weak.length, 0);
assert.equal(crossRefReport.missing.length, 0);

/** Generic stopword overlap alone must not mark weak. */
const stopwordNoise = checkSurveyFactsCoverage({
  facts: [
    {
      id: "fact_s1",
      fieldId: "fs",
      fieldTitle: "Detail",
      fieldType: "text",
      fieldDescription: null,
      stepTitle: "X",
      kind: "answer",
      label: "Detail",
      value: "Diese und jene werden hier nicht ohne weiteres übernommen.",
    },
  ],
  texts: ["Wir werden und können hier auch ohne weiteres weiterarbeiten."],
});
assert.equal(stopwordNoise.weak.length, 0);
assert.equal(stopwordNoise.missing.length, 1);

const summary = summarizeSurveyFactCoverage({
  facts: bundle.facts,
  report: covered,
});
assert.equal(summary.total, 3);
assert.equal(summary.missingCount, 0);
assert.ok(summary.coveredCount >= 2);

const repairBlock = formatFactsForCoverageRepair({
  facts: bundle.facts,
  factIds: ["fact_001", "fact_003"],
});
assert.match(repairBlock, /fact_001/);
assert.match(repairBlock, /1–3 Wochen/);
assert.match(repairBlock, /fact_003/);
assert.doesNotMatch(repairBlock, /fact_002/);

assert.ok(typeof summary.missing[0]?.valueText === "string" || summary.missing.length === 0);
assert.equal(summary.weak.every((w) => typeof w.valueText === "string"), true);

const incompleteSummary = summarizeSurveyFactCoverage({
  facts: bundle.facts,
  report: missing,
});
assert.ok(unresolvedSurveyFactCoverageIds(incompleteSummary).length >= 2);
assert.deepEqual(
  unresolvedSurveyFactCoverageIds(incompleteSummary, unresolvedSurveyFactCoverageIds(incompleteSummary)),
  [],
);
assert.ok(
  unresolvedSurveyFactCoverageIds(
    incompleteSummary,
    unresolvedSurveyFactCoverageIds(incompleteSummary).slice(1),
  ).length >= 1,
);

console.log("survey-facts tests: ok");
