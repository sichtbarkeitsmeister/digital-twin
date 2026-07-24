export const SURVEY_PURPOSES = ["persona", "anbieter"] as const;

export type SurveyPurpose = (typeof SURVEY_PURPOSES)[number];

export function isSurveyPurpose(v: unknown): v is SurveyPurpose {
  return v === "persona" || v === "anbieter";
}

export function normalizeSurveyPurpose(v: unknown): SurveyPurpose {
  return isSurveyPurpose(v) ? v : "persona";
}

export function surveyPurposeLabel(purpose: SurveyPurpose): string {
  if (purpose === "anbieter") return "Anbieter (SEO-Wissen)";
  return "Kunden-Persona (Avatar)";
}
