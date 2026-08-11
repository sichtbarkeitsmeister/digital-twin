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
assert.doesNotMatch(knowledge, /fact_001/);
assert.doesNotMatch(knowledge, /Pflicht-Checkliste/);
assert.doesNotMatch(knowledge, /Coverage:/);
assert.match(knowledge, /\*\*Firmenname\*\*/);

const rankingKnowledge = buildAnbieterSeoKnowledgeBlock({
  surveyTitle: "Anbieter Ranking",
  organisationName: "MSH",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Positionierung",
        description: "",
        fields: [
          {
            id: "f-rank",
            type: "ranking",
            title: "Prioritäten der Mandanten",
            description: "",
            required: true,
            options: [
              { id: "o1", label: "Geschwindigkeit" },
              { id: "o2", label: "Rechtssicherheit" },
              { id: "o3", label: "Preis" },
            ],
          },
        ],
      },
    ],
  },
  answers: {
    "f-rank": {
      items: [
        { kind: "preset", label: "Rechtssicherheit" },
        { kind: "preset", label: "Geschwindigkeit" },
      ],
      excludedPresets: ["Preis"],
    },
  },
  fieldQuestions: [],
  responseId: "resp-rank",
});

assert.match(rankingKnowledge, /\*\*Prioritäten der Mandanten\*\*/);
assert.match(rankingKnowledge, /Rangfolge \(1 = höchste Priorität\):/);
assert.match(rankingKnowledge, /^1\. Rechtssicherheit$/m);
assert.match(rankingKnowledge, /^2\. Geschwindigkeit$/m);
assert.match(rankingKnowledge, /Nicht gewählt: Preis/);
assert.doesNotMatch(rankingKnowledge, /3\. Preis/);
assert.doesNotMatch(rankingKnowledge, /1\. Geschwindigkeit/);

// Option ids must keep the respondent order, not the form definition order.
const rankingFromIds = buildAnbieterSeoKnowledgeBlock({
  surveyTitle: "Anbieter Ranking IDs",
  organisationName: "MSH",
  definition: {
    steps: [
      {
        id: "s1",
        title: "Positionierung",
        description: "",
        fields: [
          {
            id: "f-rank",
            type: "ranking",
            title: "Prioritäten",
            description: "",
            required: true,
            options: [
              { id: "o1", label: "Geschwindigkeit" },
              { id: "o2", label: "Rechtssicherheit" },
              { id: "o3", label: "Preis" },
            ],
          },
        ],
      },
    ],
  },
  answers: { "f-rank": ["o2", "o1"] },
  fieldQuestions: [],
  responseId: "resp-rank-ids",
});
assert.match(rankingFromIds, /^1\. Rechtssicherheit$/m);
assert.match(rankingFromIds, /^2\. Geschwindigkeit$/m);
assert.doesNotMatch(rankingFromIds, /^1\. Geschwindigkeit$/m);

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
