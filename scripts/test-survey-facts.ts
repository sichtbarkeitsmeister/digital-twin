/**
 * Stufe-1 survey facts: extraction + coverage heuristics.
 * Run: npm run test:survey-facts
 */
import assert from "node:assert/strict";

import {
  checkSurveyFactsCoverage,
  extractSurveyFacts,
  formatSurveyFactsForAgentContext,
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

console.log("survey-facts tests: ok");
