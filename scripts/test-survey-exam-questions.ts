/**
 * Survey exam / probe questions from facts.
 * Run: npx tsx scripts/test-survey-exam-questions.ts
 */
import assert from "node:assert/strict";

import { extractSurveyFacts } from "../lib/dt/survey-facts";
import {
  buildSurveyExamQuestions,
  fixGermanDuVerbAgreement,
  rewriteCustomerThirdPersonToSecondPerson,
} from "../lib/dt/survey-exam-questions";

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
      /partner|anbieter|reihenfolge|priorität/i.test(q.question) &&
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

// Packed dental description → Behandler only because the SOLL text contains it
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
  packedQs.some((q) => /behandler|praxisgröße|wie groß ist die praxis/i.test(q.question)),
  "Practice size probe may use Behandler only when present in SOLL",
);
assert.ok(
  packedQs.some((q) => /wie alt bist du|altersgruppe/i.test(q.question)),
  "Age slice must become its own question",
);
assert.ok(
  packedQs.some((q) => /schwerpunkt/i.test(q.question)),
  "Specializations must become their own question",
);
assert.ok(
  packedQs.some((q) => /1-6 Behandler/i.test(q.expectedHint)),
  "SOLL for size probe must expose 1-6 Behandler",
);
assert.ok(
  !packedQs.some((q) => /nenn mir konkret:.*behandler/i.test(q.question)),
  "Must not use the old dental multi-fact checklist dump",
);

// Care relative description must NOT invent dental Behandler/Labor wording
const careFacts = extractSurveyFacts({
  surveyTitle: "Care",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Wunschkunde",
        description: "",
        fields: [
          {
            id: "f_care",
            type: "textarea" as const,
            title: "Beschreibung des idealen Wunschkunden in 3-5 Sätzen",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_contact_care",
            type: "text" as const,
            title: "Wie nehmen Wunschkunden erstmals Kontakt auf?",
            description: "",
            required: false,
            options: [],
          },
        ],
      },
    ],
  },
  answers: {
    f_care:
      "Ehefrau, Anfang 50, Beatmungspflichtig, konnte nach Jahren langsamer Entwöhnung wieder alleine atmen",
    f_contact_care: "Über Empfehlung und Website",
  },
  fieldQuestions: [],
});
const careQs = buildSurveyExamQuestions(careFacts.facts, {
  audience: "persona",
  maxQuestions: 10,
});
assert.ok(
  careQs.some((q) => /wer bist du|beschäftigt dich|situation/i.test(q.question)),
  "Care description should ask in sales-discovery tone",
);
assert.ok(
  !careQs.some((q) => /fragebogen/i.test(q.question)),
  "Persona probes must not mention the questionnaire",
);
assert.ok(
  !careQs.some((q) => /behandler|praxis|labor/i.test(q.question)),
  "Care persona must not get dental-hardcoded probes",
);
assert.ok(
  careQs.some((q) => /Ehefrau|Beatmung|Entwöhnung/i.test(q.expectedHint)),
);

// Homeowner / renovation: no Labor/Behandler either
const homeFacts = extractSurveyFacts({
  surveyTitle: "Home",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Wunschkunde",
        description: "",
        fields: [
          {
            id: "f_home",
            type: "textarea" as const,
            title: "Beschreibung des idealen Wunschkunden",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_budget",
            type: "text" as const,
            title: "Typisches Budget der Wunschkunden",
            description: "",
            required: false,
            options: [],
          },
        ],
      },
    ],
  },
  answers: {
    f_home: "40+ Angestellter, Freiberufler oder Unternehmer; Interesse Dachgeschossausbau",
    f_budget: "150-200k",
  },
  fieldQuestions: [],
});
const homeQs = buildSurveyExamQuestions(homeFacts.facts, {
  audience: "persona",
  maxQuestions: 10,
});
assert.ok(homeQs.some((q) => /budget|preisspanne/i.test(q.question)));
assert.ok(!homeQs.some((q) => /gilt bei dir \(\„|welches budget bzw/i.test(q.question)));
assert.ok(!homeQs.some((q) => /behandler|labor|praxis/i.test(q.question)));

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

// Grammar + sales tone: employee talking to prospect, no “diese du”, no dry budget wrap
assert.equal(
  rewriteCustomerThirdPersonToSecondPerson("Wie alt sind diese Personen meistens?"),
  "Wie alt bist du meistens?",
);
assert.equal(
  rewriteCustomerThirdPersonToSecondPerson(
    "Welche Situation hat diese Personen zu Einfach Entrümpelung geführt?",
  ),
  "Was hat dich zu uns geführt?",
);
assert.equal(
  rewriteCustomerThirdPersonToSecondPerson(
    "Was erzählen Wunschkunden über ihre Lebenssituation im Erstgespräch?",
  ),
  "Was erzählst du über deine Lebenssituation im Erstgespräch?",
);
assert.equal(
  fixGermanDuVerbAgreement("Was erzählen du über Ihre Situation? Wie beschreiben sie es?"),
  "Was erzählst du über deine Situation? Wie beschreibst du es?",
);

const declutterFacts = extractSurveyFacts({
  surveyTitle: "Entrümpelung",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Wunschkunde",
        description: "",
        fields: [
          {
            id: "f_age",
            type: "text" as const,
            title: "Wie alt sind diese Personen meistens?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_why",
            type: "text" as const,
            title: "Welche Situation hat diese Personen zu Einfach Entrümpelung geführt?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_tell",
            type: "text" as const,
            title: "Was erzählen diese Personen über die Situation im ersten Gespräch?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_react",
            type: "text" as const,
            title: "Wie reagieren Wunschkunden typischerweise auf den Preis?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_price_unsure",
            type: "text" as const,
            title: "Ab welchem Preis oder bei welchen Aussagen werden Wunschkunden unsicher?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_fixed",
            type: "text" as const,
            title: "Wollen Wunschkunden lieber einen festen Preis?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_range",
            type: "text" as const,
            title: "In welcher Preisspanne bewegen sich typische Aufträge?",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_budget",
            type: "text" as const,
            title: "Typisches Budget der Wunschkunden",
            description: "",
            required: false,
            options: [],
          },
          {
            id: "f_desc",
            type: "textarea" as const,
            title: "Beschreibung des idealen Wunschkunden in 3-5 Sätzen",
            description: "",
            required: false,
            options: [],
          },
        ],
      },
    ],
  },
  answers: {
    f_age: "55-75",
    f_why: "Nach einem Todesfall bleibt eine volle Wohnung zurück.",
    f_tell: "„Ich weiß nicht, wo ich anfangen soll.“",
    f_react: "Meist erleichtert.",
    f_price_unsure: "Ab ca. 3.000 Euro.",
    f_fixed: "Ja, lieber einen festen Preis.",
    f_range: "800–2.500 Euro",
    f_budget: "800–2.500 Euro",
    f_desc: "Angehörige, die nach einem Todesfall räumen müssen.",
  },
  fieldQuestions: [],
});
const declutterQs = buildSurveyExamQuestions(declutterFacts.facts, {
  audience: "persona",
  maxQuestions: 16,
});
assert.ok(
  declutterQs.some((q) => /wie alt bist du/i.test(q.question)),
  "Age probe should be natural Du-form",
);
assert.ok(!declutterQs.some((q) => /diese du|sind diese|personen/i.test(q.question)));
assert.ok(
  declutterQs.some((q) => /zu uns geführt|was hat dich/i.test(q.question)),
  "Why-us should sound like a sales discovery question",
);
assert.ok(!declutterQs.some((q) => /einfach entrümpelung/i.test(q.question)));
assert.ok(declutterQs.some((q) => /erzählst du/i.test(q.question)));
assert.ok(!declutterQs.some((q) => /erzählen du/i.test(q.question)));
assert.ok(
  declutterQs.some((q) => /reagierst du.*preis|preis.*reagierst/i.test(q.question)),
);
assert.ok(declutterQs.some((q) => /festen preis|willst du lieber/i.test(q.question)));
assert.ok(
  !declutterQs.some((q) => /welches budget bzw|gilt bei dir \(\„/i.test(q.question)),
  "Must not wrap every price topic in the dry budget template",
);
assert.ok(declutterQs.some((q) => /preisspanne bewegst du dich/i.test(q.question)));
assert.ok(declutterQs.some((q) => /wer bist du/i.test(q.question)));
assert.ok(!declutterQs.some((q) => /fragebogen/i.test(q.question)));

console.log("survey-exam-questions tests: ok");
