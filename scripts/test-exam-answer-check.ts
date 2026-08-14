import assert from "node:assert/strict";

import {
  heuristicExamAnswerSuggestion,
  parseExamAnswerSuggestion,
} from "../lib/dt/exam-answer-check";
import { resolveCustomExamExpectedHint } from "../lib/dt/survey-exam-questions";

assert.deepEqual(
  parseExamAnswerSuggestion(
    '{"suggested":"pass","reason":"Alter 35–45 ist enthalten.","confidence":"high"}',
  ),
  {
    suggested: "pass",
    reason: "Alter 35–45 ist enthalten.",
    confidence: "high",
  },
);
assert.equal(parseExamAnswerSuggestion("no json here"), null);
assert.equal(
  parseExamAnswerSuggestion(
    '{"suggested":"fail","reason":"Kerninhalt fehlt.","confidence":"medium"}',
  )?.suggested,
  "fail",
);

const passHeuristic = heuristicExamAnswerSuggestion({
  expectedHint: "Telefon, E-Mail, Persönlich vor Ort / bei Fortbildung",
  assistantAnswer:
    "Ich rufe meist telefonisch an, schreibe eine E-Mail oder spreche persönlich vor Ort bei Fortbildungen.",
});
assert.equal(passHeuristic.suggested, "pass");

const failHeuristic = heuristicExamAnswerSuggestion({
  expectedHint: "Telefon, E-Mail, Persönlich vor Ort",
  assistantAnswer: "Ich warte einfach ab und hoffe auf Weiterempfehlungen.",
});
assert.equal(failHeuristic.suggested, "fail");

const bank = [
  {
    question: "Wie alt bist du ungefähr?",
    expectedHint: "Alter 35-45 Jahre",
  },
  {
    question: "Was ärgert dich am meisten bei Anbietern?",
    expectedHint: "Lange Wartezeiten und unklare Preise",
  },
];

const matched = resolveCustomExamExpectedHint("Wie alt bist du?", bank);
assert.equal(matched.source, "matched");
assert.match(matched.expectedHint, /35-45/);

const digest = resolveCustomExamExpectedHint(
  "Erzähl mir etwas ganz anderes über deine Hobbys beim Segeln",
  bank,
);
assert.equal(digest.source, "digest");
assert.match(digest.expectedHint, /Fragebogen-Auszug/);
assert.match(digest.expectedHint, /35-45/);
assert.match(digest.expectedHint, /Wartezeiten/);

console.log("exam-answer-check parse tests: ok");
