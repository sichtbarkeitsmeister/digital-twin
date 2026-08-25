import { applySurveyPatchOperations } from "@/lib/ai/survey-patch";
import type { SurveyAiProposal } from "@/lib/ai/survey-assistant-types";
import {
  mergeSurveyIntoReviewDraft,
  surveyFromReview,
  type FragebogenReviewDraft,
} from "@/lib/surveys/fragebogen-review-draft";

function proposalSurveyId(proposal: SurveyAiProposal): string | null {
  if (
    proposal.kind === "patch_survey_definition" ||
    proposal.kind === "edit_survey_definition" ||
    proposal.kind === "update_survey_metadata"
  ) {
    return proposal.surveyId ?? null;
  }
  return null;
}

export function isLiveWizardSurveyProposal(
  proposal: SurveyAiProposal,
  liveSurveyId: string | null | undefined,
): boolean {
  if (!liveSurveyId) return false;
  if (proposal.kind === "batch") {
    if (proposal.steps.length === 0) return false;
    return proposal.steps.every((step) => {
      if (
        step.kind === "patch_survey_definition" ||
        step.kind === "edit_survey_definition" ||
        step.kind === "update_survey_metadata"
      ) {
        return !step.surveyId || step.surveyId === liveSurveyId;
      }
      return false;
    });
  }
  if (proposal.kind === "edit_survey_definition") {
    return !proposal.surveyId || proposal.surveyId === liveSurveyId;
  }
  return proposalSurveyId(proposal) === liveSurveyId;
}

type WizardApplyOk = { ok: true; draft: FragebogenReviewDraft; skipped: string[] };
type WizardApplyFail = { ok: false; message: string };

function applyAtomicProposalToWizardDraft(
  draft: FragebogenReviewDraft,
  proposal: Extract<
    SurveyAiProposal,
    { kind: "patch_survey_definition" | "edit_survey_definition" | "update_survey_metadata" }
  >,
): WizardApplyOk | WizardApplyFail {
  const base = surveyFromReview(draft);
  const liveId = base.id;

  if (proposal.kind === "patch_survey_definition") {
    if (proposal.surveyId !== liveId) {
      return { ok: false, message: "Der Vorschlag gehört nicht zum offenen Fragebogen-Entwurf." };
    }
    const patched = applySurveyPatchOperations({
      baseSurvey: base,
      operations: proposal.operations as Parameters<
        typeof applySurveyPatchOperations
      >[0]["operations"],
    });
    if (!patched.ok) return patched;
    return {
      ok: true,
      draft: mergeSurveyIntoReviewDraft(draft, patched.survey),
      skipped: patched.skipped,
    };
  }

  if (proposal.kind === "edit_survey_definition") {
    if (proposal.surveyId && proposal.surveyId !== liveId) {
      return { ok: false, message: "Der Vorschlag gehört nicht zum offenen Fragebogen-Entwurf." };
    }
    return { ok: true, draft: mergeSurveyIntoReviewDraft(draft, proposal.survey), skipped: [] };
  }

  if (proposal.surveyId !== liveId) {
    return { ok: false, message: "Der Vorschlag gehört nicht zum offenen Fragebogen-Entwurf." };
  }
  return {
    ok: true,
    draft: {
      ...draft,
      title: proposal.title?.trim() || draft.title,
      description: proposal.description ?? draft.description,
    },
    skipped: [],
  };
}

export function applySurveyProposalToWizardDraft(
  draft: FragebogenReviewDraft,
  proposal: SurveyAiProposal,
): WizardApplyOk | WizardApplyFail {
  if (proposal.kind === "batch") {
    let next = draft;
    const skipped: string[] = [];
    for (const step of proposal.steps) {
      if (
        step.kind !== "patch_survey_definition" &&
        step.kind !== "edit_survey_definition" &&
        step.kind !== "update_survey_metadata"
      ) {
        return {
          ok: false,
          message:
            "Diese Sammelaktion enthält Schritte, die sich im offenen Fragebogen-Entwurf nicht direkt anwenden lassen.",
        };
      }
      const applied = applyAtomicProposalToWizardDraft(next, step);
      if (!applied.ok) return applied;
      next = applied.draft;
      skipped.push(...applied.skipped);
    }
    return { ok: true, draft: next, skipped };
  }

  if (
    proposal.kind === "patch_survey_definition" ||
    proposal.kind === "edit_survey_definition" ||
    proposal.kind === "update_survey_metadata"
  ) {
    return applyAtomicProposalToWizardDraft(draft, proposal);
  }

  return {
    ok: false,
    message: "Diese Aktion lässt sich im offenen Fragebogen-Entwurf nicht direkt anwenden.",
  };
}
