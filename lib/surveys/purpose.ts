export const SURVEY_PURPOSES = ["persona", "anbieter", "intern"] as const;

export type SurveyPurpose = (typeof SURVEY_PURPOSES)[number];

export function isSurveyPurpose(v: unknown): v is SurveyPurpose {
  return v === "persona" || v === "anbieter" || v === "intern";
}

export function normalizeSurveyPurpose(v: unknown): SurveyPurpose {
  return isSurveyPurpose(v) ? v : "persona";
}

export function surveyPurposeLabel(purpose: SurveyPurpose): string {
  if (purpose === "anbieter") return "Anbieter (SEO-Wissen)";
  if (purpose === "intern") return "Intern (Agentur)";
  return "Kunden-Persona (Avatar)";
}

export function surveyPurposeShortLabel(purpose: string): string {
  if (purpose === "anbieter") return "Anbieter";
  if (purpose === "intern") return "Intern";
  return "Persona";
}
