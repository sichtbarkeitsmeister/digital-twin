/**
 * Agent prompt vs questionnaire coverage helpers.
 * Run: npx tsx scripts/test-agent-survey-coverage.ts
 */
import assert from "node:assert/strict";

import { comparePromptToSurveyFacts } from "../lib/dt/agent-survey-coverage";
import type { SurveyFact } from "../lib/dt/survey-facts";

const facts: SurveyFact[] = [
  {
    id: "fact_001",
    fieldId: "f1",
    fieldTitle: "Alter",
    fieldType: "text",
    fieldDescription: null,
    stepTitle: "Profil",
    kind: "answer",
    label: "Alter",
    value: "45–55 Jahre",
  },
  {
    id: "fact_002",
    fieldId: "f2",
    fieldTitle: "Prioritäten",
    fieldType: "ranking",
    fieldDescription: null,
    stepTitle: "Profil",
    kind: "answer",
    label: "Prioritäten",
    value: "Rangfolge (1 = höchste Priorität):\n1. Qualität\n2. Preis",
  },
];

const covered = comparePromptToSurveyFacts({
  facts,
  promptTemplate:
    "Du bist Heike, 45–55 Jahre alt. Deine Prioritäten: Rangfolge (1 = höchste Priorität): 1. Qualität 2. Preis.",
  promptAppend: null,
});
assert.ok(covered.coveredCount >= 1);
assert.ok(covered.missingCount <= 1);

const missing = comparePromptToSurveyFacts({
  facts,
  promptTemplate: "Du bist eine Persona ohne konkrete Angaben.",
  promptAppend: null,
});
assert.ok(missing.missingCount >= 1);
assert.ok(
  missing.missing.some((m) => /45–55|Qualität/i.test(m.valueText)),
);

console.log("agent-survey-coverage tests: ok");
