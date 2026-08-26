/**
 * Parse survey JSON (bare definition or export bundle) for replace-into-existing.
 * Run: npx tsx scripts/test-import-survey-json.ts
 */
import assert from "node:assert/strict";

import {
  definitionForExistingSurvey,
  parseImportedSurveyJson,
} from "../lib/surveys/import-survey-json";
import type { SurveyParsed } from "../lib/surveys/schema";

const definition: SurveyParsed = {
  version: 1,
  id: "def-from-json",
  title: "Neue Fragen",
  description: "Aus JSON",
  infoTextEnabled: false,
  infoText: "",
  answerPlaceholder: "Deine Antwort…",
  steps: [
    {
      id: "step_a",
      title: "Einstieg",
      description: "",
      fields: [
        {
          id: "q1",
          type: "text",
          title: "Wie heißt der Wunschmandant?",
          description: "",
          required: true,
          placeholder: "",
        },
      ],
    },
  ],
};

const bare = parseImportedSurveyJson(definition);
assert.equal(bare.ok, true);
if (bare.ok) {
  assert.equal(bare.data.definition.steps[0]?.fields[0]?.title, "Wie heißt der Wunschmandant?");
  assert.equal(bare.data.title, "Neue Fragen");
}

const bundle = parseImportedSurveyJson({
  version: 1,
  survey: {
    title: "Bundle-Titel",
    description: "Bundle-Text",
    definition,
  },
});
assert.equal(bundle.ok, true);
if (bundle.ok) {
  assert.equal(bundle.data.title, "Bundle-Titel");
  assert.equal(bundle.data.description, "Bundle-Text");
  assert.equal(bundle.data.definition.steps.length, 1);
}

const wrapped = parseImportedSurveyJson({ definition });
assert.equal(wrapped.ok, true);

const invalid = parseImportedSurveyJson({ foo: 1 });
assert.equal(invalid.ok, false);

const applied = definitionForExistingSurvey({
  existingDefinitionId: "keep-me",
  existingTitle: "Kopie von Persona",
  existingDescription: "Bleibt",
  imported: definition,
});
assert.equal(applied.id, "keep-me");
assert.equal(applied.title, "Kopie von Persona");
assert.equal(applied.description, "Bleibt");
assert.equal(applied.steps[0]?.id, "step_a");

console.log("import-survey-json: ok");
