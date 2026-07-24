/**
 * Tests for Anbieter → SEO knowledge merge helpers.
 * Run: npx tsx scripts/test-anbieter-to-seo.ts
 */
import assert from "node:assert/strict";

import {
  ANBIETER_WISSEN_END,
  ANBIETER_WISSEN_START,
  buildAnbieterSeoKnowledgeBlock,
  mergeAnbieterKnowledgeIntoPromptAppend,
} from "../lib/dt/anbieter-to-seo";

const knowledge = buildAnbieterSeoKnowledgeBlock({
  surveyTitle: "Anbieter Fragebogen Test",
  organisationName: "Einfach Entrümpelung",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Firma",
        description: "",
        fields: [
          {
            id: "f1",
            type: "text",
            title: "Firmenname",
            description: "",
            required: true,
          },
          {
            id: "f2",
            type: "text",
            title: "Leer",
            description: "",
            required: false,
          },
        ],
      },
    ],
  },
  answers: { f1: "Einfach Entrümpelung Düsseldorf" },
  fieldQuestions: [],
  responseId: "resp-1",
});

assert.match(knowledge, /Einfach Entrümpelung Düsseldorf/);
assert.match(knowledge, /Firmenname/);
assert.doesNotMatch(knowledge, /### Leer/);

const mergedEmpty = mergeAnbieterKnowledgeIntoPromptAppend(null, knowledge);
assert.match(mergedEmpty, new RegExp(ANBIETER_WISSEN_START));
assert.match(mergedEmpty, /Anbieter-Wissen/);

const withManual = mergeAnbieterKnowledgeIntoPromptAppend(
  "Du kennst die Praxis. Praxis-Basisdaten: Test.",
  knowledge,
);
assert.match(withManual, /Praxis-Basisdaten/);
assert.match(withManual, /Einfach Entrümpelung Düsseldorf/);

const replaced = mergeAnbieterKnowledgeIntoPromptAppend(
  withManual,
  "Neue Fakten aus Fragebogen v2",
);
assert.match(replaced, /Neue Fakten aus Fragebogen v2/);
assert.doesNotMatch(replaced, /Einfach Entrümpelung Düsseldorf/);
assert.match(replaced, /Praxis-Basisdaten/);
assert.equal(replaced.indexOf(ANBIETER_WISSEN_START) >= 0, true);
assert.equal(replaced.indexOf(ANBIETER_WISSEN_END) >= 0, true);

console.log("OK: anbieter-to-seo tests passed");
