/**
 * Survey duplicate helpers.
 * Run: npx tsx scripts/test-survey-duplicate.ts
 */
import assert from "node:assert/strict";

import {
  buildDuplicatedSurveyTitle,
  withNewSurveyDefinitionId,
} from "../lib/surveys/duplicate";
import type { SurveyParsed } from "../lib/surveys/schema";

assert.equal(buildDuplicatedSurveyTitle("TM Dental"), "Kopie von TM Dental");
assert.equal(buildDuplicatedSurveyTitle("  "), "Kopie von Umfrage");
assert.equal(buildDuplicatedSurveyTitle(""), "Kopie von Umfrage");

const base: SurveyParsed = {
  version: 1,
  id: "orig-survey-id",
  title: "Test",
  description: "",
  infoTextEnabled: false,
  infoText: "",
  answerPlaceholder: "Deine Antwort…",
  steps: [
    {
      id: "s1",
      title: "Schrittieg",
      description: "",
      fields: [
        {
          id: "f1",
          type: "text",
          title: "Name",
          description: "",
          required: false,
          placeholder: "",
        },
      ],
    },
  ],
};

const copied = withNewSurveyDefinitionId(base);
assert.notEqual(copied.id, base.id);
assert.equal(copied.steps[0]?.fields[0]?.id, "f1");
assert.equal(copied.title, "Test");

console.log("survey-duplicate tests: ok");
