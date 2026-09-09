/**
 * Persona-Testing helpers (exam questions availability for survey-built agents).
 * Run: npx tsx scripts/test-persona-testing.ts
 */
import assert from "node:assert/strict";

import { agentSupportsPersonaTesting } from "../lib/dt/persona-testing";
import { buildSurveyExamQuestions } from "../lib/dt/survey-exam-questions";
import { extractSurveyFacts } from "../lib/dt/survey-facts";

assert.equal(
  agentSupportsPersonaTesting({
    source_survey_id: "s1",
    source_survey_response_id: "r1",
  }),
  true,
);
assert.equal(
  agentSupportsPersonaTesting({
    source_survey_id: null,
    source_survey_response_id: "r1",
  }),
  false,
);
assert.equal(
  agentSupportsPersonaTesting({
    source_survey_id: "s1",
    source_survey_response_id: null,
  }),
  false,
);
assert.equal(agentSupportsPersonaTesting(null), false);

const definition = {
  steps: [
    {
      id: "s1",
      title: "Einstieg",
      description: "",
      fields: [
        {
          id: "f1",
          type: "text" as const,
          title: "Was sind deine größten Sorgen?",
          description: "",
          required: false,
          options: [],
        },
      ],
    },
  ],
};

const facts = extractSurveyFacts({
  surveyTitle: "Persona",
  definition,
  answers: { f1: "Die Entwöhnung" },
  fieldQuestions: [],
});

const questions = buildSurveyExamQuestions(facts.facts, { maxQuestions: 6 });
assert.ok(questions.length >= 2);
assert.ok(
  questions.some((q) => /beschäftigt dich|Sorgen|erzählen/i.test(q.question)),
  "Worry/pain fields should become a natural sales discovery probe",
);
assert.ok(
  questions.some((q) => q.id.startsWith("core_")),
  "Persona-Check starts with the fixed core script",
);

const companyQuestions = buildSurveyExamQuestions(facts.facts, {
  audience: "company",
  maxQuestions: 6,
  organisationName: "Online Media Atelier",
});
assert.ok(
  companyQuestions.every(
    (q) => !/\b(euch|eurem|seid ihr|habt ihr)\b/i.test(q.question),
  ),
  "Firmen-Test must not use ihr/euch",
);
assert.ok(
  companyQuestions.some((q) => /Online Media Atelier/i.test(q.question)),
  "Firmen-Test names the organisation",
);

console.log("persona-testing tests: ok");
