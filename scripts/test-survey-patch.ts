/**
 * Survey-KI patches must still apply when the model uses the wrong stepId
 * or references fields that the current questionnaire no longer has.
 * Run: npx tsx scripts/test-survey-patch.ts
 */
import assert from "node:assert/strict";

import {
  applySurveyPatchOperations,
  describePatchAppliedMessage,
} from "../lib/ai/survey-patch";
import { parseSurveyAiProposal } from "../lib/ai/survey-assistant-types";
import {
  PERSONA_CORE_QUESTIONS,
  buildCoreFields,
} from "../lib/surveys/core-question-templates";
import { surveySchema } from "../lib/surveys/schema";
import type { Survey } from "../lib/surveys/types";

const SURVEY_ID = "51061931-aebd-413d-8a8e-d1397976081e";

function personaSurvey(extraFields?: {
  stepId: string;
  field: Survey["steps"][number]["fields"][number];
}): Survey {
  const { steps } = buildCoreFields(PERSONA_CORE_QUESTIONS);
  if (extraFields) {
    const step = steps.find((s) => s.id === extraFields.stepId);
    assert.ok(step, extraFields.stepId);
    step.fields.push(extraFields.field);
  }
  return surveySchema.parse({
    version: 1,
    id: SURVEY_ID,
    title: "Wunschmandant Westprüfung",
    description: "",
    steps,
  });
}

function fieldById(survey: Survey, fieldId: string) {
  for (const step of survey.steps) {
    const field = step.fields.find((f) => f.id === fieldId);
    if (field) return { step, field };
  }
  return null;
}

function rankingOptionLabel(survey: Survey, fieldId: string, index: number): string | null {
  const found = fieldById(survey, fieldId);
  if (!found || found.field.type !== "ranking") return null;
  return found.field.options[index]?.label ?? null;
}

const westpruefungProposal = {
  kind: "patch_survey_definition" as const,
  summary:
    "Wunschmandant-Fragebogen optimiert: 2 doppelte Fragen zusammengeführt, 12 Felder mit aussagekräftigen Beschreibungen erweitert, Trust-Signals und Goals um Westprüfung-spezifische Optionen ergänzt",
  surveyId: SURVEY_ID,
  operations: [
    {
      op: "update_field" as const,
      patch: {
        description:
          "Der Auslöser ist das konkrete Ereignis oder die Lebenssituation, die diese Person dazu bewegt, überhaupt eine Anwaltskanzlei zu kontaktieren.",
      },
      stepId: "core_persona_problems",
      fieldId: "core_persona_trigger",
    },
    {
      op: "delete_field" as const,
      stepId: "core_persona_language",
      fieldId: "core_persona_first_contact_phrases",
    },
    {
      op: "update_field" as const,
      patch: {
        title:
          "Wie beschreibt dieser Mandant sein Problem – wortwörtliche Formulierungen beim ersten Kontakt?",
        description: "Hier interessieren die genauen Worte.",
      },
      stepId: "core_persona_problems",
      fieldId: "core_persona_pain",
    },
    {
      op: "update_field" as const,
      patch: { description: "Emotionale Treiber." },
      stepId: "core_persona_problems",
      fieldId: "core_persona_unspoken_drivers",
    },
    {
      op: "update_field" as const,
      patch: { description: "Schlechte Erfahrungen vor Westprüfung." },
      stepId: "core_persona_problems",
      fieldId: "core_persona_past_frustrations",
    },
    {
      op: "update_field" as const,
      patch: { description: "Zeit bis zur Beauftragung." },
      stepId: "core_persona_buying",
      fieldId: "core_persona_time_to_order",
    },
    {
      op: "update_field" as const,
      patch: { description: "Tipping Point." },
      stepId: "core_persona_buying",
      fieldId: "core_persona_tipping_point",
    },
    {
      op: "update_field" as const,
      patch: { description: "Warum nein." },
      stepId: "core_persona_buying",
      fieldId: "core_persona_why_no",
    },
    {
      op: "update_field" as const,
      patch: { description: "Drop-off." },
      stepId: "core_persona_journey",
      fieldId: "core_persona_journey_dropoff",
    },
    {
      op: "update_field" as const,
      patch: { description: "Rückkehrverhalten." },
      stepId: "core_persona_aftercare",
      fieldId: "core_persona_return_behavior",
    },
    {
      op: "update_field" as const,
      patch: { description: "Unzufriedenheit." },
      stepId: "core_persona_aftercare",
      fieldId: "core_persona_dissatisfaction",
    },
    {
      op: "update_field" as const,
      patch: { description: "Erwartete Geschwindigkeit." },
      stepId: "core_persona_hormozi",
      fieldId: "core_persona_hormozi_speed",
    },
    {
      op: "update_field" as const,
      patch: {
        options: [
          { id: "persona_goal_1", label: "Testament / Erbvertrag rechtssicher gestalten" },
          { id: "persona_goal_2", label: "Pflichtteilsansprüche durchsetzen oder abwehren" },
        ],
      },
      stepId: "core_persona_demo",
      fieldId: "core_persona_goals",
    },
    {
      op: "update_field" as const,
      patch: {
        options: [
          {
            id: "persona_trust_1",
            label: "Langjährige Erfahrung und Spezialisierung im Erbrecht",
          },
          { id: "persona_trust_2", label: "Fachanwalt für Steuerrecht und Erbrecht" },
        ],
      },
      stepId: "core_persona_trust",
      fieldId: "core_persona_trust_signals",
    },
  ],
};

const parsedProposal = parseSurveyAiProposal(westpruefungProposal);
assert.equal(parsedProposal.success, true, "Westprüfung-Proposal muss schema-gültig sein");

const currentTemplates = personaSurvey();
assert.equal(fieldById(currentTemplates, "core_persona_unspoken_drivers"), null);
assert.equal(fieldById(currentTemplates, "core_persona_return_behavior"), null);
assert.equal(fieldById(currentTemplates, "core_persona_hormozi_speed"), null);
assert.ok(fieldById(currentTemplates, "core_persona_goals")?.step.id === "core_persona_problems");

const applied = applySurveyPatchOperations({
  baseSurvey: currentTemplates,
  operations: westpruefungProposal.operations,
});
if (!applied.ok) throw new Error(applied.message);

assert.ok(applied.skipped.includes("core_persona_unspoken_drivers"));
assert.ok(applied.skipped.includes("core_persona_return_behavior"));
assert.ok(applied.skipped.includes("core_persona_hormozi_speed"));
assert.equal(applied.skipped.length, 3);

assert.match(
  fieldById(applied.survey, "core_persona_trigger")?.field.description ?? "",
  /Anwaltskanzlei/,
);
assert.equal(fieldById(applied.survey, "core_persona_first_contact_phrases"), null);
assert.match(
  fieldById(applied.survey, "core_persona_pain")?.field.title ?? "",
  /wortwörtliche Formulierungen/,
);
assert.equal(
  rankingOptionLabel(applied.survey, "core_persona_goals", 0),
  "Testament / Erbvertrag rechtssicher gestalten",
);
assert.equal(
  rankingOptionLabel(applied.survey, "core_persona_trust_signals", 0),
  "Langjährige Erfahrung und Spezialisierung im Erbrecht",
);

assert.match(
  describePatchAppliedMessage(applied.skipped),
  /3 Felder lagen nicht \(mehr\) im Fragebogen/,
);

const wrongStepOnly = applySurveyPatchOperations({
  baseSurvey: currentTemplates,
  operations: [
    {
      op: "update_field",
      stepId: "core_persona_demo",
      fieldId: "core_persona_pain",
      patch: { title: "Neues Label trotz falschem Schritt" },
    },
  ],
});
if (!wrongStepOnly.ok) throw new Error(wrongStepOnly.message);
assert.equal(wrongStepOnly.skipped.length, 0);
assert.equal(
  fieldById(wrongStepOnly.survey, "core_persona_pain")?.field.title,
  "Neues Label trotz falschem Schritt",
);

const missingOnly = applySurveyPatchOperations({
  baseSurvey: currentTemplates,
  operations: [
    {
      op: "update_field",
      stepId: "core_persona_problems",
      fieldId: "core_persona_unspoken_drivers",
      patch: { description: "fehlt" },
    },
  ],
});
assert.equal(missingOnly.ok, false);
if (!missingOnly.ok) {
  assert.match(missingOnly.message, /core_persona_unspoken_drivers/);
}

const legacyWithRemovedFields = personaSurvey({
  stepId: "core_persona_problems",
  field: {
    id: "core_persona_unspoken_drivers",
    type: "text",
    title: "Unausgesprochene Treiber",
    description: "",
    required: false,
  },
});
const legacyApplied = applySurveyPatchOperations({
  baseSurvey: legacyWithRemovedFields,
  operations: [
    {
      op: "update_field",
      stepId: "core_persona_problems",
      fieldId: "core_persona_unspoken_drivers",
      patch: { description: "Emotionale Treiber." },
    },
  ],
});
if (!legacyApplied.ok) throw new Error(legacyApplied.message);
assert.equal(legacyApplied.skipped.length, 0);
assert.equal(
  fieldById(legacyApplied.survey, "core_persona_unspoken_drivers")?.field.description,
  "Emotionale Treiber.",
);

console.log("ok: survey patch apply");
