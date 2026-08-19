"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type { SeoPageHealth, SeoPageHealthIssue } from "@/lib/dt/seo/page-health";
import { cn } from "@/lib/utils";

const AREA_LABEL: Record<SeoPageHealthIssue["area"], string> = {
  config: "Konfiguration",
  crawl: "Crawl",
  ga4: "GA4",
  gsc: "GSC",
  report: "Report",
};

function IssueRow(props: {
  issue: SeoPageHealthIssue;
  onFix?: (hint: NonNullable<SeoPageHealthIssue["fixHint"]>) => void;
}) {
  const { issue, onFix } = props;
  const isError = issue.level === "error";
  return (
    <li className="flex flex-wrap items-start gap-2">
      <span
        className={cn(
          "mt-0.5 inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          isError
            ? "bg-red-500/15 text-red-800 dark:text-red-200"
            : "bg-amber-500/15 text-amber-900 dark:text-amber-100",
        )}
      >
        {AREA_LABEL[issue.area]}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">{issue.message}</span>
      {issue.fixHint && onFix ? (
        <button
          type="button"
          className="shrink-0 text-xs font-semibold underline underline-offset-2"
          onClick={() => onFix(issue.fixHint!)}
        >
          Beheben
        </button>
      ) : null}
    </li>
  );
}

/**
 * Visible SEO error/warning panel — show whenever health has issues.
 */
export function DtSeoPageErrorsPanel(props: {
  health: SeoPageHealth;
  /** Compact: hide the green “alles ok” state. */
  hideWhenClean?: boolean;
  onFix?: (hint: NonNullable<SeoPageHealthIssue["fixHint"]>) => void;
  className?: string;
}) {
  const { health, hideWhenClean = true, onFix, className } = props;

  if (health.clean) {
    if (hideWhenClean) return null;
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100",
          className,
        )}
        role="status"
      >
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">Keine offenen SEO-Probleme für diese Organisation.</span>
      </div>
    );
  }

  const title = health.ok
    ? `${health.warnings.length} Hinweis${health.warnings.length === 1 ? "" : "e"} — bitte prüfen`
    : `${health.errors.length} Fehler${health.warnings.length ? ` · ${health.warnings.length} Hinweis${health.warnings.length === 1 ? "" : "e"}` : ""} — bitte beheben`;

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        health.ok
          ? "border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100"
          : "border-red-500/35 bg-red-500/10 text-red-900 dark:text-red-100",
        className,
      )}
      role={health.ok ? "status" : "alert"}
      data-testid="seo-page-errors"
    >
      <div className="flex items-start gap-2">
        {health.ok ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1 grid gap-2">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <ul className="grid gap-1.5">
            {health.issues.map((issue) => (
              <IssueRow key={issue.code} issue={issue} onFix={onFix} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
