/**
 * Org Fragebögen list: open the fill UI (`/s/{slug}`) so customers can continue
 * answering. Admin review (Antwort-Details) stays on /dashboard/surveys.
 */
export function organisationSurveyOpenHref(survey: {
  surveyId: string;
  slug: string | null;
  visibility: string | null;
  responseId: string | null;
}): string {
  const slug = survey.slug?.trim();
  if (slug && survey.visibility === "public") return `/s/${slug}`;
  if (survey.responseId) {
    return `/dashboard/surveys/${survey.surveyId}/responses/${survey.responseId}`;
  }
  return `/dashboard/surveys/${survey.surveyId}/edit`;
}
