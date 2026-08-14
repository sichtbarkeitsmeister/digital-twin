import assert from "node:assert/strict";

import {
  buildExamCheckUserPrompt,
  heuristicExamAnswerSuggestion,
  looksLikeCompanyKnowledgeProbe,
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

assert.equal(
  looksLikeCompanyKnowledgeProbe("Was weißt du alles über freiraumvier?"),
  true,
);
assert.equal(looksLikeCompanyKnowledgeProbe("Wie alt bist du ungefähr?"), false);

const companyProbeHeuristic = heuristicExamAnswerSuggestion({
  question: "Was weißt du alles über freiraumvier?",
  audience: "persona",
  expectedHint:
    "Leistungen: Dachausbau, 3D-Visualisierung, Gewerkekoordination seit 2002, Festpreisgarantie",
  assistantAnswer:
    "Ich habe euch online gefunden und weiß, dass ihr alles koordiniert und 3D macht – mehr Details kenne ich noch nicht.",
});
assert.equal(companyProbeHeuristic.suggested, "pass");
assert.match(companyProbeHeuristic.reason, /oberfläch/i);

const personaPrompt = buildExamCheckUserPrompt({
  question: "Was weißt du alles über freiraumvier?",
  expectedHint: "Budget 80-120k, online gefunden",
  assistantAnswer: "Nur oberflächlich von der Website.",
  audience: "persona",
});
assert.match(personaPrompt, /Interessent\/Pre-Sale/);
assert.match(personaPrompt, /Leistungskatalog ist KEIN fail/i);
assert.doesNotMatch(personaPrompt, /muss sinngemäß vorkommen/);

const companyPrompt = buildExamCheckUserPrompt({
  question: "Welche Leistungen bietet ihr?",
  expectedHint: "Dachausbau, Koordination",
  assistantAnswer: "Wir machen Dachausbau.",
  audience: "company",
});
assert.match(companyPrompt, /muss sinngemäß vorkommen/);

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
