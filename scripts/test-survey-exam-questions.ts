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
    f3: {
      items: [
        { kind: "preset", label: "Vertrauen" },
        { kind: "preset", label: "Preis" },
      ],
      excludedPresets: [],
    },
  },
  fieldQuestions: [],
});

const questions = buildSurveyExamQuestions(bundle.facts, {
  maxQuestions: 10,
  audience: "persona",
});
assert.ok(questions.length >= 4);
// Fact probes first — warmups are last (verification priority).
assert.ok(questions[0]?.factId, "first question should be tied to a survey fact");
assert.ok(questions.some((q) => /aufmerksam geworden/i.test(q.question)));
assert.ok(questions.some((q) => /Sorgen|Einwände|beschäftigt/i.test(q.question)));
assert.ok(questions.some((q) => /wichtigsten|Priorität|Reihenfolge|sortieren/i.test(q.question)));
assert.ok(!questions.some((q) => /was steht bei dir bei/i.test(q.question)));
assert.ok(questions.some((q) => q.id.startsWith("warmup_")));
assert.match(
  questions.find((q) => q.factId === "fact_001")?.expectedHint ?? "",
  /Empfehlung/,
);

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
        {
          id: "f_company_named",
          type: "text" as const,
          title: "Mit welchen Zahnärzten arbeitet TM Dentaltechnik am liebsten zusammen?",
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
    f_rank: {
      items: [
        { kind: "preset", label: "Empfehlung" },
        { kind: "preset", label: "Messe" },
      ],
      excludedPresets: [],
    },
    f_company: "Mit Qualitätsorientierten Praxen",
    f_company_named: "Mit Qualitätsorientierten Praxen",
  },
  fieldQuestions: [],
});

const personaQs = buildSurveyExamQuestions(dentalFacts.facts, {
  audience: "persona",
  maxQuestions: 14,
});

assert.ok(personaQs.some((q) => /wie heißt du/i.test(q.question)));
assert.ok(
  personaQs.some((q) => /wie alt bist du|altersgruppe/i.test(q.question)),
  "Age should be asked as a concrete fact probe",
);
assert.ok(
  !personaQs.some((q) => /erzähl mal kurz:\s*wer bist du/i.test(q.question)),
  "Soft bio dump should not replace concrete fact probes",
);
assert.ok(personaQs.some((q) => /wie nimmst du erstmals kontakt|kontakt/i.test(q.question)));
assert.ok(
  personaQs.some(
    (q) =>
      /labor|partner|anbieter|reihenfolge|priorität/i.test(q.question) &&
      !/was steht bei dir bei/i.test(q.question),
  ),
  "Ranking probes should sound natural (not checklist-style)",
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
assert.ok(
  !personaQs.some((q) => /tm dentaltechnik/i.test(q.question)),
  "Named-company probes must not become Wunschkunde exam questions",
);
assert.ok(
  !personaQs.some((q) => /arbeitet tm dentaltechnik/i.test(q.question)),
);
assert.ok(
  personaQs.every((q) => !q.factId || q.expectedHint.trim().length > 0),
  "Fact-tied probes must expose the questionnaire expectation",
);

// Packed description → split into concrete MA / Alter / Schwerpunkt probes
const packedDescFacts = extractSurveyFacts({
  surveyTitle: "Packed",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Wunschkunde",
        description: "",
        fields: [
          {
            id: "f_packed",
            type: "textarea" as const,
            title: "Beschreibung des idealen Wunsch-Zahnarztes in 3-5 Sätzen",
            description: "",
            required: false,
            options: [],
          },
        ],
      },
    ],
  },
  answers: {
    f_packed:
      "Alter: 35-45\nPraxisgröße: 1-6 Behandler\nSchwerpunkte: Implantologie und Prothetik",
  },
  fieldQuestions: [],
});
const packedQs = buildSurveyExamQuestions(packedDescFacts.facts, {
  audience: "persona",
  maxQuestions: 10,
});
assert.ok(
  packedQs.some((q) => /wie viele mitarbeiter|behandler|wie groß ist die praxis/i.test(q.question)),
  "Practice size must become a concrete MA/Behandler question",
);
assert.ok(
  packedQs.some((q) => /wie alt bist du|altersgruppe/i.test(q.question)),
  "Age slice must become its own question",
);
assert.ok(
  packedQs.some((q) => /schwerpunkte hast du/i.test(q.question)),
  "Specializations must become their own question",
);
assert.ok(
  packedQs.some((q) => /1-6 Behandler/i.test(q.expectedHint)),
  "SOLL for size probe must expose 1-6 Behandler",
);
assert.ok(
  !packedQs.some((q) => /erzähl mal kurz/i.test(q.question)),
  "Packed description must not collapse into soft bio question",
);

// Comma-separated packed description without colons on every field
const commaPacked = extractSurveyFacts({
  surveyTitle: "CommaPacked",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Wunschkunde",
        description: "",
        fields: [
          {
            id: "f_comma",
            type: "textarea" as const,
            title: "Beschreibung des idealen Wunsch-Zahnarztes in 3-5 Sätzen",
            description: "",
            required: false,
            options: [],
          },
        ],
      },
    ],
  },
  answers: {
    f_comma: "Alter 35-45, Praxisgröße 1-6 Behandler, Schwerpunkte Implantologie und Prothetik",
  },
  fieldQuestions: [],
});
const commaQs = buildSurveyExamQuestions(commaPacked.facts, {
  audience: "persona",
  maxQuestions: 10,
});
assert.ok(
  commaQs.some((q) => /wie viele mitarbeiter|behandler/i.test(q.question)),
  "Comma-packed size must become MA/Behandler question",
);
assert.ok(commaQs.some((q) => /1-6 Behandler/i.test(q.expectedHint)));
assert.ok(commaQs.some((q) => /wie alt bist du/i.test(q.question)));
assert.ok(commaQs.some((q) => /schwerpunkte hast du/i.test(q.question)));

const companyQs = buildSurveyExamQuestions(dentalFacts.facts, {
  audience: "company",
  maxQuestions: 12,
});
assert.ok(companyQs.some((q) => q.id.startsWith("warmup_company")));
assert.ok(companyQs.some((q) => /labor am liebsten/i.test(q.question)));
assert.ok(companyQs[0]?.factId, "company testing should lead with fact verification");
assert.match(
  companyQs.find((q) => /labor am liebsten/i.test(q.question))?.expectedHint ?? "",
  /Qualitätsorientierten/,
);

console.log("survey-exam-questions tests: ok");
