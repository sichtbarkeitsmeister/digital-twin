/**
 * Regression tests for survey remark clarification detection.
 * Run: npm run test:survey-clarifications
 */
import assert from "node:assert/strict";

import {
  buildImportPreviewFromBundle,
  detectSurveyClarifications,
  resolveClarificationSourcePool,
  type SurveyClarificationItem,
  type SurveyClarificationSource,
} from "../lib/dt/survey-clarifications";
import type { SurveyFactsBundle } from "../lib/dt/survey-facts";

const definition = {
  steps: [
    {
      id: "s1",
      title: "Ablauf",
      description: "",
      fields: [
        {
          id: "f-ablauf",
          type: "text" as const,
          title: "Wie läuft die Anfrage ab?",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f-mandatsreise",
          type: "textarea" as const,
          title: "Mandatsreise",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f-phasen",
          type: "textarea" as const,
          title: "Phasen und Bedürfnisse",
          description: "",
          required: false,
          options: [],
        },
        {
          id: "f-other",
          type: "text" as const,
          title: "Sonstiges",
          description: "",
          required: false,
          options: [],
        },
      ],
    },
  ],
};

const anbieterRemark = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q1",
      field_id: "f-ablauf",
      kind: "remark",
      question: "Selber Ablauf wie im Anbieter Fragebogen",
      answer: null,
    },
  ],
});

assert.equal(anbieterRemark.length, 1);
assert.equal(anbieterRemark[0]?.type, "cross_reference");
assert.equal(anbieterRemark[0]?.suggestedAction, "import_anbieter_survey");
assert.equal(anbieterRemark[0]?.suggestedPurpose, "anbieter");
assert.equal(anbieterRemark[0]?.fieldTitle, "Wie läuft die Anfrage ab?");
assert.match(anbieterRemark[0]?.remarkText ?? "", /Selber Ablauf/i);

const vagueRemark = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q2",
      field_id: "f-other",
      kind: "remark",
      question: "Siehe oben / wie üblich",
      answer: null,
    },
  ],
});

assert.equal(vagueRemark.length, 1);
assert.equal(vagueRemark[0]?.type, "ambiguous_remark");
assert.ok(
  vagueRemark[0]?.suggestedAction === "import_sibling_survey" ||
    vagueRemark[0]?.suggestedAction === "provide_manual",
);

const clearRemark = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q3",
      field_id: "f-other",
      kind: "remark",
      question: "Kunde bevorzugt Rückruf am Nachmittag",
      answer: null,
    },
  ],
});

assert.equal(clearRemark.length, 0);

const followUpQuestionOnlyIgnored = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q4",
      field_id: "f-ablauf",
      kind: "question",
      question: "Wie im Anbieter?",
      answer: "Ja",
    },
  ],
});

// Interviewer-Frage darf allein keinen Treffer erzeugen — nur die Antwort zählt.
assert.equal(followUpQuestionOnlyIgnored.length, 0);

const followUpAnswerCrossRef = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q5",
      field_id: "f-ablauf",
      kind: "question",
      question: "Können Sie den Ablauf genauer beschreiben?",
      answer: "Siehe Arbeitgeber-Fragebogen",
    },
  ],
});

assert.equal(followUpAnswerCrossRef.length, 1);
assert.equal(followUpAnswerCrossRef[0]?.preferredSourceHint, "arbeitgeber");

const arbeitgeberAnswer = detectSurveyClarifications({
  definition,
  fieldQuestions: [],
  answers: {
    "f-mandatsreise":
      "Ist die gleiche wie beim Arbeitgeber. Bitte dort übernehmen.",
  },
});

assert.equal(arbeitgeberAnswer.length, 1);
assert.equal(arbeitgeberAnswer[0]?.type, "cross_reference");
assert.equal(arbeitgeberAnswer[0]?.suggestedAction, "import_sibling_survey");
assert.equal(arbeitgeberAnswer[0]?.suggestedPurpose, "persona");
assert.equal(arbeitgeberAnswer[0]?.preferredSourceHint, "arbeitgeber");
assert.equal(arbeitgeberAnswer[0]?.fieldTitle, "Mandatsreise");

const sieheArbeitgeber = detectSurveyClarifications({
  definition,
  fieldQuestions: [],
  answers: {
    "f-phasen": "siehe Arbeitgeber-Fragebogen",
  },
});

assert.equal(sieheArbeitgeber.length, 1);
assert.equal(sieheArbeitgeber[0]?.preferredSourceHint, "arbeitgeber");
assert.match(sieheArbeitgeber[0]?.remarkText ?? "", /Arbeitgeber/i);

const sampleItem: SurveyClarificationItem = {
  id: "clar-answer-f-mandatsreise",
  type: "cross_reference",
  questionId: "answer-f-mandatsreise",
  fieldId: "f-mandatsreise",
  fieldTitle: "Mandatsreise",
  remarkText: "Ist die gleiche wie beim Arbeitgeber.",
  detectedIntent: "Verweis",
  suggestedAction: "import_sibling_survey",
  suggestedPurpose: "persona",
  preferredSourceHint: "arbeitgeber",
};

const sampleSources: SurveyClarificationSource[] = [
  {
    responseId: "11111111-1111-1111-1111-111111111111",
    surveyId: "s1",
    surveyTitle: "MSH Arbeitnehmer Petra",
    purpose: "persona",
    purposeLabel: "Persona",
    completedAt: null,
  },
  {
    responseId: "22222222-2222-2222-2222-222222222222",
    surveyId: "s2",
    surveyTitle: "MSH Arbeitgeber Heike",
    purpose: "persona",
    purposeLabel: "Persona",
    completedAt: null,
  },
];

const found = resolveClarificationSourcePool(sampleSources, sampleItem);
assert.equal(found.foundMatch, true);
assert.equal(found.best?.surveyTitle, "MSH Arbeitgeber Heike");
assert.equal(found.pool.length, 1);

const missing = resolveClarificationSourcePool([], sampleItem);
assert.equal(missing.foundMatch, false);
assert.equal(missing.best, null);
assert.match(missing.statusMessage, /selbst angeben/i);

const employerBundle: SurveyFactsBundle = {
  surveyTitle: "MSH Arbeitgeber",
  skippedFieldCount: 0,
  facts: [
    {
      id: "fact_001",
      fieldId: "f1",
      fieldTitle: "Beschreibe die typische Mandatsreise in 5–7 Schritten.",
      fieldType: "textarea",
      fieldDescription: null,
      stepTitle: "Reise",
      kind: "answer",
      label: "Beschreibe die typische Mandatsreise in 5–7 Schritten.",
      value: "1. Problembewusstsein\n2. Recherche\n3. Erstgespräch",
    },
    {
      id: "fact_002",
      fieldId: "f2",
      fieldTitle: "Andere Frage",
      fieldType: "text",
      fieldDescription: null,
      stepTitle: "Sonstiges",
      kind: "answer",
      label: "Andere Frage",
      value: "Irrelevant",
    },
  ],
};

const importPreview = buildImportPreviewFromBundle({
  clarificationId: sampleItem.id,
  sourceResponseId: "22222222-2222-2222-2222-222222222222",
  sourceSurveyTitle: "MSH Arbeitgeber",
  bundle: employerBundle,
  fieldTitle: "Beschreibe die typische Mandatsreise in 5–7 Schritten.",
  remarkText: "Ist die gleiche wie beim Arbeitgeber.",
});

assert.equal(importPreview.scope, "focused");
assert.equal(importPreview.facts.length, 1);
assert.match(importPreview.facts[0]?.value ?? "", /Problembewusstsein/);

console.log("survey-clarifications tests: ok");
