/**
 * Regression tests for survey → agent Q&A preprocessing.
 * Run: npm run test:survey-to-agent
 */
import assert from "node:assert/strict";

import {
  buildSurveyResponseContextForAgent,
  isPlaceholderOrEmptyAnswer,
  normalizeSurveyAnswer,
} from "../lib/dt/survey-to-agent-context";
import {
  formatRankingAnswerForDisplay,
  hasStoredRankingAnswer,
  isRankingAnswerValid,
} from "../lib/surveys/ranking-answer";
import type { SurveyField } from "../lib/surveys/types";

const rankingOptions = [
  { id: "o1", label: "Option A" },
  { id: "o2", label: "Option B" },
  { id: "o3", label: "5,0 Sterne / 171 Bewertungen" },
];
const labels = rankingOptions.map((o) => o.label);

// --- ranking: unanswered must not invent form-order rankings ---
assert.equal(hasStoredRankingAnswer(undefined), false);
assert.equal(hasStoredRankingAnswer(null), false);
assert.equal(hasStoredRankingAnswer({ items: [], excludedPresets: [] }), false);
assert.equal(formatRankingAnswerForDisplay(undefined, labels), "");
assert.equal(formatRankingAnswerForDisplay(null, labels), "");
assert.equal(isRankingAnswerValid(undefined, labels, false), true);
assert.equal(isRankingAnswerValid(undefined, labels, true), false);

const realRanking = {
  items: [
    { kind: "preset" as const, label: "Option B" },
    { kind: "preset" as const, label: "Option A" },
  ],
  excludedPresets: ["5,0 Sterne / 171 Bewertungen"],
};
assert.equal(hasStoredRankingAnswer(realRanking), true);
const formatted = formatRankingAnswerForDisplay(realRanking, labels);
assert.match(formatted, /^1\. Option B/);
assert.match(formatted, /2\. Option A/);
assert.doesNotMatch(formatted, /5,0 Sterne/);

// --- normalizeSurveyAnswer ranking ---
const rankingField: SurveyField = {
  id: "f-rank",
  type: "ranking",
  title: "Auslöser für den Anruf",
  description: "",
  required: false,
  options: rankingOptions,
};
assert.equal(normalizeSurveyAnswer(undefined, rankingField), "");
assert.ok(normalizeSurveyAnswer(realRanking, rankingField).includes("1. Option B"));

// --- placeholders ---
assert.equal(isPlaceholderOrEmptyAnswer(""), true);
assert.equal(isPlaceholderOrEmptyAnswer("—"), true);
assert.equal(isPlaceholderOrEmptyAnswer("---"), true);
assert.equal(isPlaceholderOrEmptyAnswer("nichts."), true);
assert.equal(isPlaceholderOrEmptyAnswer("1–3 Wochen"), false);

// --- context builder: skip unanswered, keep answered + remarks ---
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
        },
        {
          id: "f4",
          type: "text" as const,
          title: "Nur mit Bemerkung",
          description: "",
          required: false,
        },
      ],
    },
  ],
};

const context = buildSurveyResponseContextForAgent({
  surveyTitle: "Einfach Entrümpelung Düsseldorf",
  definition,
  answers: {
    f1: "1–3 Wochen",
    f3: "Alex Müller",
    // f2 intentionally unanswered
    // f4 unanswered but has remark below
  },
  fieldQuestions: [
    {
      id: "q1",
      field_id: "f4",
      kind: "remark",
      question: "Kunde wirkte gestresst",
      answer: null,
    },
  ],
});

assert.match(context, /1–3 Wochen/);
assert.match(context, /Alex Müller/);
assert.match(context, /Kunde wirkte gestresst/);
assert.doesNotMatch(context, /Auslöser für den Anruf/);
assert.doesNotMatch(context, /5,0 Sterne \/ 171 Bewertungen/);
assert.doesNotMatch(context, /1\. Option A/);
assert.match(context, /3 beantwortete Fragen übernommen, 1 unbeantwortete/);

console.log("OK: survey-to-agent context preprocessing tests passed");
