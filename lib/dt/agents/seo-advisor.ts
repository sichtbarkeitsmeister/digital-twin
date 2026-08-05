/** Agents reserved for platform-admin SEO workspace — hidden from org members. */
export function isSeoAdvisorAgent(agent: {
  slug?: string | null;
  kind?: string | null;
}): boolean {
  return (
    agent.slug === "seo_advisor" ||
    agent.kind === "seo_advisor" ||
    agent.kind === "geo_advisor"
  );
}

type AgentVisibilityInput = {
  slug?: string | null;
  kind?: string | null;
  is_enabled?: boolean | null;
  isEnabled?: boolean | null;
};

/**
 * Legacy starter persona (slug=default). New orgs no longer get one; existing
 * unused starters are soft-disabled. Still hidden from customers when present.
 */
export function isDefaultTwinAgent(agent: { slug?: string | null }): boolean {
  return agent.slug === "default";
}

function isAgentEnabled(agent: AgentVisibilityInput): boolean {
  return agent.is_enabled ?? agent.isEnabled ?? true;
}

export function filterAgentsHiddenFromOrgMembers<T extends AgentVisibilityInput>(
  agents: T[],
): T[] {
  const withoutAdvisor = agents.filter((agent) => !isSeoAdvisorAgent(agent));
  const withoutDefaultTwin = withoutAdvisor.filter((agent) => !isDefaultTwinAgent(agent));

  // Keep the default twin as a fallback while an organisation has no other
  // usable avatar — otherwise the chat would be left without any agent.
  return withoutDefaultTwin.some(isAgentEnabled) ? withoutDefaultTwin : withoutAdvisor;
}

export function isSeoUsageEvent(
  row: { mode?: string | null; agent_id?: string | null },
  agentsById: Map<string, { slug?: string | null; kind?: string | null }>,
): boolean {
  if (row.mode === "seo") return true;
  if (!row.agent_id) return false;
  const agent = agentsById.get(row.agent_id);
  return agent ? isSeoAdvisorAgent(agent) : false;
}

export function filterUsageEventsForOrgMembers<
  T extends { mode?: string | null; agent_id?: string | null },
>(
  rows: T[],
  agentsById: Map<string, { slug?: string | null; kind?: string | null }>,
): T[] {
  return rows.filter((row) => !isSeoUsageEvent(row, agentsById));
}
