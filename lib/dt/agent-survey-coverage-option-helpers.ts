export type AgentCoverageSurveyOption = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  purpose: "persona" | "anbieter";
  completedAt: string | null;
  /** True when this is the agent's stored source lineage. */
  isSource: boolean;
};

export function pickDefaultCoverageOption(
  options: AgentCoverageSurveyOption[],
): AgentCoverageSurveyOption | null {
  return options.find((o) => o.isSource) ?? options[0] ?? null;
}

export function formatCoverageOptionLabel(
  option: AgentCoverageSurveyOption,
): string {
  const date = option.completedAt
    ? new Date(option.completedAt).toLocaleDateString("de-DE")
    : null;
  const source = option.isSource ? " · Herkunft" : "";
  return `${option.surveyTitle}${date ? ` (${date})` : ""}${source}`;
}
