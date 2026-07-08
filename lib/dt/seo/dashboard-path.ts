/** Any dashboard route that belongs to the SEO workspace area. */
export function isSeoDashboardPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/verwaltung/seo" ||
    pathname.startsWith("/dashboard/verwaltung/seo/") ||
    pathname === "/dashboard/digital-twin/seo" ||
    pathname.startsWith("/dashboard/digital-twin/seo/")
  );
}

/** Organisation overview page with top-bar org selector. */
export function isOrganisationDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/organisations";
}

/** Agent management / context pages that share the dashboard org bar. */
export function isManageOrgBarPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/verwaltung/agent-kontext" ||
    pathname.startsWith("/dashboard/verwaltung/agent-kontext/") ||
    pathname === "/dashboard/verwaltung/agents" ||
    pathname.startsWith("/dashboard/verwaltung/agents/") ||
    pathname === "/dashboard/digital-twin/agents" ||
    pathname.startsWith("/dashboard/digital-twin/agents/")
  );
}

export function isDashboardOrgBarPath(pathname: string): boolean {
  return (
    isSeoDashboardPath(pathname) ||
    isManageOrgBarPath(pathname) ||
    isOrganisationDashboardPath(pathname)
  );
}

/** Main SEO workspace with tabs (chat, tasks, …) — not crawl/report sub-pages. */
export function isSeoWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/dashboard/verwaltung/seo" ||
    pathname === "/dashboard/digital-twin/seo"
  );
}
