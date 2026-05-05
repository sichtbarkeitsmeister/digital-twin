import type { Survey } from "@/lib/surveys/types";
import { surveySchema } from "@/lib/surveys/schema";

const STORAGE_KEY = "dt_survey_draft_v1";

function buildStorageKey(draftId?: string) {
  if (!draftId) return STORAGE_KEY;
  return `${STORAGE_KEY}:${draftId}`;
}

export function loadDraftSurvey(draftId?: string): Survey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(buildStorageKey(draftId));
    if (!raw) return null;
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = surveySchema.safeParse(parsedJson);
    if (!parsed.success) return null;
    return parsed.data as Survey;
  } catch {
    return null;
  }
}

export function saveDraftSurvey(survey: Survey, draftId?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      buildStorageKey(draftId),
      JSON.stringify(survey, null, 2),
    );
  } catch {
    // ignore quota / privacy mode
  }
}

export function clearDraftSurvey(draftId?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(buildStorageKey(draftId));
  } catch {
    // ignore
  }
}

export { STORAGE_KEY as SURVEY_DRAFT_STORAGE_KEY };

