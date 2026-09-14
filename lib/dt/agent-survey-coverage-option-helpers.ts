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

function coverageMatchNeedles(agentName: string, extraLabels?: string | string[] | null): string[] {
  const labels = [
    agentName,
    ...(Array.isArray(extraLabels) ? extraLabels : extraLabels ? [extraLabels] : []),
  ];
  const needles: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized.length >= 3 && !seen.has(normalized)) {
      seen.add(normalized);
      needles.push(normalized);
    }
    for (const token of normalized.split(/[\s/|,;·–—-]+/).filter((t) => t.length >= 4)) {
      if (!seen.has(token)) {
        seen.add(token);
        needles.push(token);
      }
    }
  }
  return needles;
}

/**
 * Prefer stored source, then title match to the agent name/role, then newest.
 */
export function suggestCoverageOptionForAgent(
  options: AgentCoverageSurveyOption[],
  agentName: string,
  extraLabels?: string | string[] | null,
): AgentCoverageSurveyOption | null {
  const source = options.find((o) => o.isSource);
  if (source) return source;

  const needles = coverageMatchNeedles(agentName, extraLabels);
  for (const needle of needles) {
    const hit = options.find((o) => o.surveyTitle.toLowerCase().includes(needle));
    if (hit) return hit;
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
