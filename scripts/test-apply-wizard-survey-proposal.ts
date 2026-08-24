/**
 * Apply Survey-KI proposals onto the live Fragebogen wizard draft.
 * Run: npx tsx scripts/test-apply-wizard-survey-proposal.ts
 */
import assert from "node:assert/strict";

import {
  applySurveyProposalToWizardDraft,
  isLiveWizardSurveyProposal,
} from "../lib/surveys/apply-wizard-survey-proposal";
import type { SurveyAiProposal } from "../lib/ai/survey-assistant-types";
import {
  surveyFromReview,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
} from "../lib/surveys/fragebogen-review-draft";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function coreQuestion(): ReviewQuestionItem {
  return {
    id: "core_persona_name",
    kind: "core",
    coreKey: "persona_name",
    title: "Wie heißt der digitale Kunden-Avatar?",
    description: "Vorname / Kurzname.",
    included: true,
    required: true,
    type: "text",
    options: [],
    answer: "Max Mustermann",
    answerSource: "meeting",
    answerNote: "Aus Gespräch",
  };
}

function draft(): FragebogenReviewDraft {
  return {
    title: "Persona: Test",
    description: "Testfragebogen",
    purpose: "persona",
    extraPlacement: "end",
    crawlPageCount: 0,
    websiteUrl: null,
    organisationName: "Test GmbH",
    definitionId: DRAFT_ID,
    questions: [coreQuestion()],
    aiWarning: null,
  };
}

const base = draft();
const survey = surveyFromReview(base);
assert.equal(survey.id, DRAFT_ID);
const stepId = survey.steps[0]?.id;
assert.ok(stepId);

assert.equal(
  isLiveWizardSurveyProposal(
    {
      kind: "patch_survey_definition",
      summary: "Kürzer",
      surveyId: DRAFT_ID,
      operations: [
        {
          op: "update_field",
          stepId,
          fieldId: "core_persona_name",
          patch: { title: "Wie heißt der Avatar?" },
        },
      ],
    },
    DRAFT_ID,
  ),
  true,
);
assert.equal(
  isLiveWizardSurveyProposal(
    {
      kind: "patch_survey_definition",
      summary: "Andere Umfrage",
      surveyId: OTHER_ID,
      operations: [
        {
          op: "update_field",
          stepId,
          fieldId: "core_persona_name",
          patch: { title: "x" },
        },
      ],
    },
    DRAFT_ID,
  ),
  false,
);
assert.equal(
  isLiveWizardSurveyProposal(
    {
      kind: "edit_survey_definition",
      summary: "Ohne ID",
      survey,
    } as Extract<SurveyAiProposal, { kind: "edit_survey_definition" }>,
    DRAFT_ID,
  ),
  true,
);

const patched = applySurveyProposalToWizardDraft(base, {
  kind: "patch_survey_definition",
  summary: "Titel der Frage kürzen",
  surveyId: DRAFT_ID,
  operations: [
    {
      op: "update_field",
      stepId,
      fieldId: "core_persona_name",
      patch: { title: "Wie heißt der Avatar?" },
    },
  ],
});
if (!patched.ok) throw new Error(patched.message);
assert.equal(patched.draft.questions[0]?.title, "Wie heißt der Avatar?");
assert.equal(patched.draft.questions[0]?.answer, "Max Mustermann");
assert.equal(patched.draft.definitionId, DRAFT_ID);

const meta = applySurveyProposalToWizardDraft(base, {
  kind: "update_survey_metadata",
  summary: "Titel",
  surveyId: DRAFT_ID,
  title: "Persona: Mandant Anna",
});
if (!meta.ok) throw new Error(meta.message);
assert.equal(meta.draft.title, "Persona: Mandant Anna");
assert.equal(meta.draft.questions[0]?.answer, "Max Mustermann");

const wrong = applySurveyProposalToWizardDraft(base, {
  kind: "patch_survey_definition",
  summary: "Falsche ID",
  surveyId: OTHER_ID,
  operations: [
    {
      op: "update_field",
      stepId,
      fieldId: "core_persona_name",
      patch: { title: "x" },
    },
  ],
});
assert.equal(wrong.ok, false);

console.log("apply-wizard-survey-proposal: ok");
