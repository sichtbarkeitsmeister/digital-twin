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

console.log("survey-clarifications tests: ok");
