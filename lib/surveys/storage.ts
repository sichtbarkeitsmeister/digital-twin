import type { Survey } from "@/lib/surveys/types";
import { surveySchema } from "@/lib/surveys/schema";

const STORAGE_KEY = "dt_survey_draft_v1";

export function loadDraftSurvey(): Survey | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = surveySchema.safeParse(parsedJson);
    if (!parsed.success) return null;
    return parsed.data as Survey;
  } catch {
    return null;
  }
}

export function saveDraftSurvey(survey: Survey) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(survey, null, 2));
  } catch {
    // ignore quota / privacy mode
  }
}

export function clearDraftSurvey() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export { STORAGE_KEY as SURVEY_DRAFT_STORAGE_KEY };

