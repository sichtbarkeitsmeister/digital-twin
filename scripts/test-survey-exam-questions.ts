/**
 * Survey exam / probe questions from facts.
 * Run: npx tsx scripts/test-survey-exam-questions.ts
 */
import assert from "node:assert/strict";

import { extractSurveyFacts } from "../lib/dt/survey-facts";
import { buildSurveyExamQuestions } from "../lib/dt/survey-exam-questions";

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
          title: "Wie bist du auf uns aufmerksam geworden?",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f2",
          type: "text" as const,
          title: "Was sind deine größten Sorgen?",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f3",
          type: "ranking" as const,
          title: "Prioritäten bei der Anbieterwahl",
          description: "",
          required: false,
          options: [
            { id: "o1", label: "Vertrauen" },
            { id: "o2", label: "Preis" },
          ],
        },
      ],
    },
  ],
};

const bundle = extractSurveyFacts({
  surveyTitle: "Test",
  definition,
  answers: {
    f1: "Über eine Empfehlung von Freunden",
    f2: "Die Entwöhnung und der Alltag zu Hause",
    f3: ["o1", "o2"],
  },
  fieldQuestions: [],
});

const questions = buildSurveyExamQuestions(bundle.facts, {
  maxQuestions: 10,
  audience: "persona",
});
assert.ok(questions.length >= 4);
assert.ok(questions.some((q) => /aufmerksam geworden/i.test(q.question)));
assert.ok(questions.some((q) => /Sorgen/i.test(q.question)));
assert.ok(questions.some((q) => /Prioritäten/i.test(q.question)));
assert.ok(questions[0]?.id.startsWith("warmup_"));
assert.match(questions.find((q) => q.factId === "fact_001")?.expectedHint ?? "", /Empfehlung/);

// Company-perspective persona survey → Du-questions for the Wunschkunde
const dentalDefinition = {
  steps: [
    {
      id: "s1",
      title: "Wunschkunde",
      description: "",
      fields: [
        {
          id: "f_name",
          type: "text" as const,
          title: "Name des digitalen Kunden-Avatars",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f_desc",
          type: "textarea" as const,
          title: "Beschreibung des idealen Wunsch-Zahnarztes in 3-5 Sätzen",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f_age",
          type: "text" as const,
          title: "Typisches Alter der Wunsch-Zahnärzte",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f_contact",
          type: "text" as const,
          title: "Wie nehmen Wunsch-Zahnärzte erstmals Kontakt auf?",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f_rank",
          type: "ranking" as const,
          title: "Typische Kontaktwege zu Wunsch-Zahnärzten (Ranking)",
          description: "",
          required: false,
          options: [
            { id: "o1", label: "Empfehlung" },
            { id: "o2", label: "Messe" },
          ],
        },
        {
          id: "f_company",
          type: "text" as const,
          title: "Mit welchen Zahnärzten arbeitet unser Labor am liebsten zusammen?",
          description: "",
          required: false,
          options: [],
        },
      ],
    },
  ],
};

const dentalFacts = extractSurveyFacts({
  surveyTitle: "Dental",
  definition: dentalDefinition,
  answers: {
    f_name: "Dr. Zahnlos",
    f_desc: "Qualitätsfokus, Laborwechsel nach schlechter Erfahrung.",
    f_age: "45–55",
    f_contact: "Über Empfehlungen von Kollegen",
    f_rank: ["o1", "o2"],
    f_company: "Mit Qualitätsorientierten Praxen",
  },
  fieldQuestions: [],
});

const personaQs = buildSurveyExamQuestions(dentalFacts.facts, {
  audience: "persona",
  maxQuestions: 12,
});

assert.ok(personaQs.some((q) => /wie heißt du/i.test(q.question)));
assert.ok(personaQs.some((q) => /erzähl mir bitte kurz von dir/i.test(q.question)));
assert.ok(personaQs.some((q) => /wie alt bist du/i.test(q.question)));
assert.ok(personaQs.some((q) => /wie nimmst du/i.test(q.question)));
assert.ok(
  personaQs.some(
    (q) => /kontaktwege/i.test(q.question) && /dir/i.test(q.question),
  ),
);
assert.ok(
  !personaQs.some((q) => /erzähl mir bitte: name des digitalen kunden-avatars/i.test(q.question)),
);
assert.ok(
  !personaQs.some((q) => /beschreibung des idealen wunsch/i.test(q.question)),
);
assert.ok(
  !personaQs.some((q) => /arbeitet unser labor/i.test(q.question)),
  "Company-only facts must not become Wunschkunde exam questions",
);

const companyQs = buildSurveyExamQuestions(dentalFacts.facts, {
  audience: "company",
  maxQuestions: 12,
});
assert.ok(companyQs[0]?.id.startsWith("warmup_company"));
assert.ok(companyQs.some((q) => /labor am liebsten/i.test(q.question)));
assert.ok(companyQs.some((q) => /unterscheidet euch/i.test(q.question)));

console.log("survey-exam-questions tests: ok");
