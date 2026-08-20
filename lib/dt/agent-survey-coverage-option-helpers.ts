export type AgentCoverageSurveyOption = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  purpose: "persona" | "anbieter" | "intern";
  completedAt: string | null;
  /** True when this is the agent's stored source lineage. */
  isSource: boolean;
  /** Another agent already owns this response as source (unique constraint). */
  usedByOtherAgentName?: string | null;
};

export function pickDefaultCoverageOption(
  options: AgentCoverageSurveyOption[],
): AgentCoverageSurveyOption | null {
  return options.find((o) => o.isSource) ?? options[0] ?? null;
}

/**
 * Prefer stored source, then title match to the agent name, then newest.
 */
export function suggestCoverageOptionForAgent(
  options: AgentCoverageSurveyOption[],
  agentName: string,
): AgentCoverageSurveyOption | null {
  const source = options.find((o) => o.isSource);
  if (source) return source;

  const normalized = agentName.trim().toLowerCase();
  if (normalized.length >= 3) {
    const full = options.find((o) =>
      o.surveyTitle.toLowerCase().includes(normalized),
    );
    if (full) return full;

    const tokens = normalized.split(/\s+/).filter((t) => t.length >= 4);
    for (const token of tokens) {
      const hit = options.find((o) => o.surveyTitle.toLowerCase().includes(token));
      if (hit) return hit;
    }
  }

  return options[0] ?? null;
}

export function formatCoverageOptionLabel(
  option: AgentCoverageSurveyOption,
): string {
  const date = option.completedAt
    ? new Date(option.completedAt).toLocaleDateString("de-DE")
    : null;
  const source = option.isSource ? " · Herkunft" : "";
  const used = option.usedByOtherAgentName
    ? ` · schon bei ${option.usedByOtherAgentName}`
    : "";
  return `${option.surveyTitle}${date ? ` (${date})` : ""}${source}${used}`;
}
