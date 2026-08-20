/**
 * Parse KI extra questions from model JSON.
 * Run: npx tsx scripts/test-ai-extra-questions.ts
 */
import assert from "node:assert/strict";

import {
  joinAiWarnings,
  parseAiExtraQuestions,
} from "../lib/surveys/ai-extra-questions";

assert.deepEqual(
  parseAiExtraQuestions(
    [
      "Welche Referenzen dürfen öffentlich genannt werden?",
      { title: "Gibt es saisonale Wartezeiten?" },
      { question: "Welche Tools nutzt das Team intern?" },
      "kurz",
      "Welche Referenzen dürfen öffentlich genannt werden?",
      { text: "Wie sollen Notfälle außerhalb der Öffnungszeiten erreicht werden?" },
    ],
    6,
  ),
  [
    "Welche Referenzen dürfen öffentlich genannt werden?",
    "Gibt es saisonale Wartezeiten?",
    "Welche Tools nutzt das Team intern?",
    "Wie sollen Notfälle außerhalb der Öffnungszeiten erreicht werden?",
  ],
);

assert.deepEqual(parseAiExtraQuestions({ not: "an array" }, 4), []);
assert.equal(joinAiWarnings(null, "  ", "Hinweis A.", "Hinweis B."), "Hinweis A. Hinweis B.");
assert.equal(joinAiWarnings("", null), null);

console.log("ai-extra-questions: ok");
