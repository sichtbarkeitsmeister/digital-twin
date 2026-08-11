import assert from "node:assert/strict";

import { parseExamAnswerSuggestion } from "../lib/dt/exam-answer-check";

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

console.log("exam-answer-check parse tests: ok");
