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

const followUpIgnored = detectSurveyClarifications({
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

assert.equal(followUpIgnored.length, 0);

console.log("survey-clarifications tests: ok");
