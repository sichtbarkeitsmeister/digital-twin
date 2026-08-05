import { googleAccountForN8nRouting } from "@/lib/dt/seo/google-accounts";

export type SeoReportReadinessIssue = {
  code: "missing_slug" | "missing_website" | "missing_ga4_account" | "missing_gsc_account";
  level: "blocker" | "warning";
  message: string;
};

export type SeoReportReadinessInput = {
  /** Stored organisations.slug — not a name-derived fallback. */
  organisationSlug?: string | null;
  websiteUrl?: string | null;
  ga4Account?: string | null;
  gscAccount?: string | null;
};

export type SeoReportReadiness = {
  ok: boolean;
  blockers: SeoReportReadinessIssue[];
  warnings: SeoReportReadinessIssue[];
  issues: SeoReportReadinessIssue[];
};

/** Shared checks before starting an SEO report (UI + API). */
export function evaluateSeoReportReadiness(input: SeoReportReadinessInput): SeoReportReadiness {
  const issues: SeoReportReadinessIssue[] = [];

  if (!String(input.organisationSlug ?? "").trim()) {
    issues.push({
      code: "missing_slug",
      level: "blocker",
      message: "Organisations-Slug fehlt — bitte unter Einstellungen setzen.",
    });
  }

  if (!String(input.websiteUrl ?? "").trim()) {
    issues.push({
      code: "missing_website",
      level: "blocker",
      message: "Website-URL fehlt in den SEO-Einstellungen.",
    });
  }

  if (!googleAccountForN8nRouting(input.ga4Account)) {
    issues.push({
      code: "missing_ga4_account",
      level: "warning",
      message: "GA4-Konto (SBKM) ist nicht gesetzt — bitte ads@ oder ads2@ wählen.",
    });
  }

  if (!googleAccountForN8nRouting(input.gscAccount)) {
    issues.push({
      code: "missing_gsc_account",
      level: "warning",
      message: "GSC-Konto (SBKM) ist nicht gesetzt — leer routet n8n auf ads2@.",
    });
  }

  const blockers = issues.filter((i) => i.level === "blocker");
  const warnings = issues.filter((i) => i.level === "warning");
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    issues,
  };
}
