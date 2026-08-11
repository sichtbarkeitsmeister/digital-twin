import assert from "node:assert/strict";

import {
  heuristicExamAnswerSuggestion,
  parseExamAnswerSuggestion,
} from "../lib/dt/exam-answer-check";

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

console.log("exam-answer-check parse tests: ok");
