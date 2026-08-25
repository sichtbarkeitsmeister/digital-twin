/**
 * Ensure flat model patch ops (required at top-level) normalize into valid proposals.
 * Run: npx tsx scripts/test-survey-proposal-normalize.ts
 */
import assert from "node:assert/strict";

import {
  describeSurveyProposalValidationError,
  normalizeSurveyAiProposalInput,
  normalizeSurveyPatchOperation,
  parseSurveyAiProposal,
  surveyAiProposalSchema,
} from "../lib/ai/survey-assistant-types";
import { applySurveyPatchOperations } from "../lib/ai/survey-patch";

const surveyId = "31ddfdea-401b-4744-95d4-05b789adede0";

const flatUpdateField = {
  op: "update_field",
  stepId: "step_12_hormozi_layer",
  fieldId: "field_12_1",
  required: true,
};

const normalizedOp = normalizeSurveyPatchOperation(flatUpdateField);
assert.deepEqual(normalizedOp, {
  op: "update_field",
  stepId: "step_12_hormozi_layer",
  fieldId: "field_12_1",
  patch: { required: true },
});

// Raw schema must reject the flat shape (documents the original bug).
const rawReject = surveyAiProposalSchema.safeParse({
  kind: "patch_survey_definition",
  summary: "Alle Felder auf required:true setzen",
  surveyId,
  operations: [flatUpdateField],
});
assert.equal(rawReject.success, false);

const flatProposal = {
  kind: "patch_survey_definition",
  summary: "Alle Felder auf required:true setzen",
  surveyId,
  operations: [
    flatUpdateField,
    {
      op: "update_field",
      stepId: "step_13_abschlussfragen",
      fieldId: "field_13_1",
      required: true,
    },
    {
      op: "update_step",
      stepId: "step_1",
      description: "Kurzbeschreibung",
    },
    {
      op: "update_survey_root",
      infoText: "Bitte ausfüllen",
      infoTextEnabled: true,
    },
    {
      op: "update_field",
      stepId: "step_2",
      fieldId: "field_2_1",
      patch: { title: "Bereits gepatcht" },
      required: true,
    },
  ],
};

const normalized = normalizeSurveyAiProposalInput(flatProposal) as {
  operations: Array<Record<string, unknown>>;
};
assert.deepEqual(normalized.operations[0], {
  op: "update_field",
  stepId: "step_12_hormozi_layer",
  fieldId: "field_12_1",
  patch: { required: true },
});
assert.deepEqual(normalized.operations[2], {
  op: "update_step",
  stepId: "step_1",
  patch: { description: "Kurzbeschreibung" },
});
assert.deepEqual(normalized.operations[3], {
  op: "update_survey_root",
  patch: { infoText: "Bitte ausfüllen", infoTextEnabled: true },
});
assert.deepEqual(normalized.operations[4], {
  op: "update_field",
  stepId: "step_2",
  fieldId: "field_2_1",
  patch: { title: "Bereits gepatcht", required: true },
});

const parsed = parseSurveyAiProposal(flatProposal);
assert.equal(parsed.success, true);
if (parsed.success) {
  assert.equal(parsed.data.kind, "patch_survey_definition");
  if (parsed.data.kind === "patch_survey_definition") {
    assert.equal(parsed.data.operations.length, 5);
  }
}

// Batch step with flat ops
const batchParsed = parseSurveyAiProposal({
  kind: "batch",
  summary: "Zwei Schritte",
  steps: [
    {
      kind: "patch_survey_definition",
      summary: "Required setzen",
      surveyId,
      operations: [flatUpdateField],
    },
    {
      kind: "publish",
      summary: "Veröffentlichen",
      surveyId,
    },
  ],
});
assert.equal(batchParsed.success, true);

// 51 flat required updates (matches the failing UI case)
const manyOps = Array.from({ length: 51 }, (_, i) => ({
  op: "update_field",
  stepId: `step_${Math.floor(i / 5) + 1}`,
  fieldId: `field_${i + 1}`,
  required: true,
}));
const manyParsed = parseSurveyAiProposal({
  kind: "patch_survey_definition",
  summary: "Alle Felder auf required:true setzen",
  surveyId,
  operations: manyOps,
});
assert.equal(manyParsed.success, true);

// add_field without field object must be rejected (Zod 4 z.unknown() used to allow this).
const missingFieldProposal = {
  kind: "patch_survey_definition",
  summary: "Abschlusssatz als neues Feld hinzufügen",
  surveyId,
  operations: [{ op: "add_field", stepId: "step_13_abschlussfragen" }],
};
const missingFieldParsed = parseSurveyAiProposal(missingFieldProposal);
assert.equal(missingFieldParsed.success, false);
assert.match(
  describeSurveyProposalValidationError(missingFieldProposal),
  /add_field.*field/i,
);

const validAddField = parseSurveyAiProposal({
  kind: "patch_survey_definition",
  summary: "Abschlusssatz hinzufügen",
  surveyId,
  operations: [
    {
      op: "add_field",
      stepId: "step_13_abschlussfragen",
      field: {
        id: "field_13_2",
        type: "text",
        title: "Vielen Dank!",
        description: "Abschluss",
        required: false,
        placeholder: "",
      },
    },
  ],
});
assert.equal(validAddField.success, true);

const patchGuard = applySurveyPatchOperations({
  baseSurvey: {
    version: 1,
    id: "survey_1",
    title: "T",
    description: "",
    steps: [
      {
        id: "step_13_abschlussfragen",
        title: "Abschluss",
        description: "",
        fields: [
          {
            id: "field_13_1",
            type: "text",
            title: "Noch etwas?",
            description: "",
            required: true,
            placeholder: "",
          },
        ],
      },
    ],
  },
  operations: [
    {
      op: "add_field",
      stepId: "step_13_abschlussfragen",
      field: undefined as unknown as object,
    },
  ],
});
assert.equal(patchGuard.ok, false);
if (!patchGuard.ok) {
  assert.match(patchGuard.message, /field/i);
}

const updateStepWithFields = {
  kind: "patch_survey_definition",
  summary: "Grammatik im Demo-Schritt",
  surveyId,
  operations: [
    {
      op: "update_step",
      stepId: "core_persona_demo",
      patch: {
        fields: [
          {
            id: "core_persona_job",
            type: "ranking",
            title: "Beruf",
            description: "",
            required: true,
            options: [
              { id: "persona_job_5", label: "Im Ruhestand" },
              { id: "persona_job_1", label: "Angestellte" },
            ],
            allowCustomEntries: true,
          },
        ],
      },
    },
    {
      op: "update_field",
      stepId: "core_persona_buying",
      fieldId: "core_persona_contact_is_client",
      patch: { title: "Kürzerer Titel" },
    },
  ],
};
const expanded = parseSurveyAiProposal(updateStepWithFields);
assert.equal(expanded.success, true);
if (expanded.success && expanded.data.kind === "patch_survey_definition") {
  assert.equal(expanded.data.operations[0]?.op, "update_field");
  assert.equal(
    (expanded.data.operations[0] as { fieldId?: string }).fieldId,
    "core_persona_job",
  );
  assert.equal(expanded.data.operations[1]?.op, "update_field");
  assert.equal(
    (expanded.data.operations[1] as { fieldId?: string }).fieldId,
    "core_persona_contact_is_client",
  );
}

console.log("ok: survey proposal normalize");
