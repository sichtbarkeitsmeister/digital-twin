/** Any dashboard route that belongs to the SEO workspace area. */
export function isSeoDashboardPath(pathname: string): boolean {
  return (
    pathname === "/dashboard/verwaltung/seo" ||
    pathname.startsWith("/dashboard/verwaltung/seo/") ||
    pathname === "/dashboard/digital-twin/seo" ||
    pathname.startsWith("/dashboard/digital-twin/seo/")
  );
}

/** Texte tool (content pipeline) — same organisation list and access as the SEO workspace. */
export function isTexteDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/verwaltung/texte" || pathname.startsWith("/dashboard/verwaltung/texte/");
}

/** SEO tool (step 2 of Texte from a briefing form) — same organisation list and access as Texte. */
export function isSeoTextDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/verwaltung/seo-text" || pathname.startsWith("/dashboard/verwaltung/seo-text/");
}

/** GEO tool (one Texte step on an uploaded file) — same organisation list and access as Texte. */
export function isGeoDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/verwaltung/geo" || pathname.startsWith("/dashboard/verwaltung/geo/");
}

/** Watermark tool (step 8 of Texte on an uploaded file) — same organisation list and access as Texte. */
export function isWatermarkDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/verwaltung/watermark-entfernung" || pathname.startsWith("/dashboard/verwaltung/watermark-entfernung/");
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

export function isOnboardingDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard/onboarding" || pathname.startsWith("/dashboard/onboarding/");
}

export function isDashboardOrgBarPath(pathname: string): boolean {
  return (
    isSeoDashboardPath(pathname) ||
    isTexteDashboardPath(pathname) ||
    isSeoTextDashboardPath(pathname) ||
    isGeoDashboardPath(pathname) ||
    isWatermarkDashboardPath(pathname) ||
    isManageOrgBarPath(pathname) ||
    isOrganisationDashboardPath(pathname) ||
    isOnboardingDashboardPath(pathname)
  );
}

/** Main SEO workspace with tabs (chat, tasks, …) — not crawl/report sub-pages. */
export function isSeoWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/dashboard/verwaltung/seo" ||
    pathname === "/dashboard/digital-twin/seo"
  );
}
