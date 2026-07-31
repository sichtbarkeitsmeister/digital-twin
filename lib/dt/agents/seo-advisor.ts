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

export function filterAgentsHiddenFromOrgMembers<
  T extends { slug?: string | null; kind?: string | null },
>(agents: T[]): T[] {
  return agents.filter((agent) => !isSeoAdvisorAgent(agent));
}

/** SEO workspace: only SEO/GEO advisor agents (no persona mix). */
export function filterSeoWorkspaceAgents<
  T extends { slug?: string | null; kind?: string | null },
>(agents: T[]): T[] {
  return agents.filter((agent) => isSeoAdvisorAgent(agent));
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
