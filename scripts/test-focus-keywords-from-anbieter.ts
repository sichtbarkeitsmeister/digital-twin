/**
 * Fokus-Keywords from Anbieter questionnaire.
 * Run: npx tsx scripts/test-focus-keywords-from-anbieter.ts
 */
import assert from "node:assert/strict";

import {
  extractFocusKeywordsFromAnbieterSurvey,
  joinFocusKeywords,
  looksLikeFocusKeywordFieldTitle,
} from "../lib/dt/seo/focus-keywords-from-anbieter";

assert.equal(looksLikeFocusKeywordFieldTitle("Fokus-Keywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Unsere Fokuskeywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Haupt-Keyword"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Keywords"), true);
assert.equal(looksLikeFocusKeywordFieldTitle("Firmenname"), false);
assert.equal(looksLikeFocusKeywordFieldTitle("Suchbegriffe für SEO Fokus"), true);

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

console.log("focus-keywords-from-anbieter tests: ok");
