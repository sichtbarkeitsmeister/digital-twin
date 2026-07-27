/**
 * Regression tests for survey remark clarification detection.
 * Run: npm run test:survey-clarifications
 */
import assert from "node:assert/strict";

import { detectSurveyClarifications } from "../lib/dt/survey-clarifications";

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
assert.equal(anbieterRemark[0]?.sourceKind, "remark");

const answerCrossRef = detectSurveyClarifications({
  definition,
  fieldQuestions: [],
  answers: {
    "f-ablauf": "Selber Ablauf wie im Anbieter Fragebogen",
  },
});

assert.equal(answerCrossRef.length, 1);
assert.equal(answerCrossRef[0]?.sourceKind, "answer");
assert.equal(answerCrossRef[0]?.suggestedAction, "import_anbieter_survey");

const followUpCrossRef = detectSurveyClarifications({
  definition,
  fieldQuestions: [
    {
      id: "q-fu",
      field_id: "f-ablauf",
      kind: "question",
      question: "Bitte Ablauf präzisieren",
      answer: "Wie im Anbieterfragebogen",
    },
  ],
});

assert.equal(followUpCrossRef.length, 1);
assert.equal(followUpCrossRef[0]?.sourceKind, "follow_up");

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
assert.equal(vagueRemark[0]?.suggestedAction, "import_sibling_survey");

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

const followUpDetected = detectSurveyClarifications({
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

assert.equal(followUpDetected.length, 1);
assert.equal(followUpDetected[0]?.sourceKind, "follow_up");
assert.equal(followUpDetected[0]?.suggestedAction, "import_anbieter_survey");

console.log("survey-clarifications tests: ok");
