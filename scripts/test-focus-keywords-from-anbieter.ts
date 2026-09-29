/**
 * Fokus-Keywords from Anbieter questionnaire.
 * Run: npx tsx scripts/test-focus-keywords-from-anbieter.ts
 */
import assert from "node:assert/strict";

import {
  extractFocusKeywordsFromAnbieterSurvey,
  joinFocusKeywords,
  looksLikeFocusKeywordField,
  looksLikeFocusKeywordFieldTitle,
} from "../lib/dt/seo/focus-keywords-from-anbieter";

assert.equal(looksLikeFocusKeywordFieldTitle("Fokus-Keywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Unsere Fokuskeywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Haupt-Keyword"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Keywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Firmenname"), false);
assert.equal(looksLikeFocusKeywordFieldTitle("Suchbegriffe für SEO Fokus"), true);
assert.equal(
  looksLikeFocusKeywordFieldTitle(
    "Unter welchen Wörtern soll die Firma bei Google gefunden werden – Angebotsbegriffe?",
  ),
  true,
);
assert.equal(looksLikeFocusKeywordFieldTitle("Mit welchem Ort soll die Firma gefunden werden?"), false);
assert.equal(looksLikeFocusKeywordField({ id: "core_keyword_offer", title: "Ort" }), true);
assert.equal(looksLikeFocusKeywordField({ id: "core_keyword_place", title: "Ort" }), false);

const extracted = extractFocusKeywordsFromAnbieterSurvey({
  definition: {
    version: 1,
    id: "s",
    title: "Anbieter",
    description: "",
    steps: [
      {
        id: "s1",
        title: "SEO",
        description: "",
        fields: [
          {
            id: "f_kw",
            type: "text",
            title: "Fokus-Keywords",
            description: "",
            required: false,
          },
          {
            id: "f_name",
            type: "text",
            title: "Firmenname",
            description: "",
            required: false,
          },
        ],
      },
    ],
  },
  answers: {
    f_kw: "Heckträger, Fahrradträger Dach",
    f_name: "Allround",
  },
});

assert.deepEqual(extracted.keywords, ["Heckträger", "Fahrradträger Dach"]);
assert.equal(joinFocusKeywords(extracted.keywords), "Heckträger, Fahrradträger Dach");

const empty = extractFocusKeywordsFromAnbieterSurvey({
  definition: {
    version: 1,
    id: "s",
    title: "Anbieter",
    description: "",
    steps: [
      {
        id: "s1",
        title: "SEO",
        description: "",
        fields: [
          {
            id: "f_kw",
            type: "text",
            title: "Fokus-Keywords",
            description: "",
            required: false,
          },
        ],
      },
    ],
  },
  answers: { f_kw: "" },
});
assert.equal(empty.keywords.length, 0);
assert.equal(joinFocusKeywords(empty.keywords), null);

const fromCoreQuestions = extractFocusKeywordsFromAnbieterSurvey({
  definition: {
    version: 1,
    id: "s",
    title: "Anbieter",
    description: "",
    steps: [
      {
        id: "core_market",
        title: "Bekanntheit",
        description: "",
        fields: [
          {
            id: "core_keyword_offer",
            type: "text_list",
            title:
              "Unter welchen Wörtern soll die Firma bei Google gefunden werden – Angebotsbegriffe?",
            description: "Intern heißen sie Fokus-Keywords.",
            required: false,
            options: [
              { id: "kw_offer_1", label: "" },
              { id: "kw_offer_2", label: "" },
            ],
          },
          {
            id: "core_keyword_place",
            type: "text_list",
            title: "Mit welchem Ort oder welcher Region soll die Firma bei Google gefunden werden?",
            description: "",
            required: false,
            options: [{ id: "kw_place_1", label: "" }],
          },
        ],
      },
    ],
  },
  answers: {
    core_keyword_offer: {
      entries: [
        { id: "kw_offer_1", value: "Entrümpelung Düsseldorf" },
        { id: "kw_offer_2", value: "Haushaltsauflösung" },
      ],
    },
    core_keyword_place: {
      entries: [{ id: "kw_place_1", value: "Düsseldorf" }],
    },
  },
});

assert.deepEqual(fromCoreQuestions.keywords, ["Entrümpelung Düsseldorf", "Haushaltsauflösung"]);

console.log("focus-keywords-from-anbieter tests: ok");
