"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Lightbulb,
  Loader2,
  Plug,
  Target,
  TrendingUp,
} from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtTabs } from "@/components/dt/dt-tabs";
import { DtSeoReportHtmlViewer } from "@/components/dt/seo/dt-seo-report-html-viewer";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import {
  parseSeoReportPayload,
  recipientTypeLabel,
  reportStateLabel,
  timeframeLabel,
} from "@/lib/dt/seo/report-payload";
import type { DtSeoReportRow } from "@/lib/dt/types";

const POLL_MS = 15_000;

const listStagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationHint(started: string | null, finished: string | null): string | null {
  if (!started || !finished) return null;
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "unter 1 Min.";
  return `ca. ${min} Min. Laufzeit`;
}

function reportHostname(url: string | null | undefined): string {
  if (!url?.trim()) return "SEO-Report";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "") || "SEO-Report";
  }
}

function DetailCard(props: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm";
}) {
  return (
    <DtGlassCard
      padding="none"
      className={cn("relative overflow-hidden", props.className)}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent dark:via-white/15"
        aria-hidden
      />
      <div className={cn(props.padding === "none" ? "" : "p-4 sm:p-5")}>
        {props.title ? (
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/55">
            {props.title}
          </h2>
        ) : null}
        {props.children}
      </div>
    </DtGlassCard>
  );
}

function parseKeywordList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function displayUrlLabel(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function MetaField(props: {
  label: string;
  value: string | null | undefined;
  href?: string | null;
  mono?: boolean;
}) {
  const v = props.value?.trim();
  if (!v) return null;
  return (
    <div className="grid gap-1 border-b border-sbkm-navy/6 py-4 last:border-0 dark:border-white/6">
      <dt className="text-xs font-medium text-sbkm-ink-600 dark:text-white/55">{props.label}</dt>
      <dd
        className={cn(
          "text-sm leading-relaxed text-sbkm-navy dark:text-white",
          props.mono && "font-mono text-[13px] tabular-nums",
          !props.mono && !props.href && "break-words",
        )}
      >
        {props.href ? (
          <a
            href={props.href}
            target="_blank"
            rel="noopener noreferrer"
            title={v}
            className="group inline-flex max-w-full items-start gap-1.5 text-sbkm-mint transition-colors duration-150 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:hover:text-white"
          >
            <span className="min-w-0 break-all">{displayUrlLabel(v)}</span>
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}

function DetailsSection(props: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      variants={listItem}
      className={cn(
        "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/40 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none",
        props.className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent dark:via-white/12"
        aria-hidden
      />
      <div className="flex items-start gap-3 border-b border-sbkm-navy/8 px-5 py-4 dark:border-white/8">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-dt bg-sbkm-mint/12 text-sbkm-navy dark:bg-sbkm-mint/18 dark:text-white">
          {props.icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
            {props.title}
          </h3>
          {props.description ? (
            <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">{props.description}</p>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 px-5 pb-4">{props.children}</div>
    </motion.section>
  );
}

function TimelineStep(props: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      {!props.isLast ? (
        <div
          className="absolute bottom-0 left-[7px] top-4 w-px bg-gradient-to-b from-sbkm-mint/50 to-sbkm-navy/10 dark:to-white/10"
          aria-hidden
        />
      ) : null}
      <div
        className={cn(
          "relative z-10 mt-0.5 h-4 w-4 shrink-0 rounded-full border-2",
          props.isLast
            ? "border-sbkm-mint bg-sbkm-mint/25"
            : "border-sbkm-navy/20 bg-sbkm-navy/5 dark:border-white/25 dark:bg-white/10",
        )}
        aria-hidden
      />
      <div className="min-w-0 pt-px">
        <p className="text-xs font-medium text-sbkm-ink-600 dark:text-white/55">{props.label}</p>
        <p className="mt-0.5 text-sm font-semibold tabular-nums text-sbkm-navy dark:text-white">
          {props.value}
        </p>
      </div>
    </div>
  );
}

function KeywordChipGrid(props: { keywords: string[]; variant?: "mint" | "neutral" }) {
  if (props.keywords.length === 0) return null;
  return (
    <motion.ul
      className="flex flex-wrap gap-2 py-3"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      {props.keywords.map((kw) => (
        <motion.li
          key={kw}
          variants={listItem}
          className={cn(
            "rounded-pill px-3 py-1 text-sm font-medium transition-all duration-150 hover:-translate-y-px",
            props.variant === "mint"
              ? "bg-sbkm-mint/12 text-sbkm-navy hover:bg-sbkm-mint/20 dark:bg-sbkm-mint/15 dark:text-white dark:hover:bg-sbkm-mint/25"
              : "bg-sbkm-navy/8 text-sbkm-navy hover:bg-sbkm-navy/12 dark:bg-white/10 dark:text-white dark:hover:bg-white/15",
          )}
        >
          {kw}
        </motion.li>
      ))}
    </motion.ul>
  );
}

function EmptyPanel(props: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <DetailCard>
      <div className="flex flex-col items-center gap-3 py-6 text-center sm:py-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sbkm-navy/6 text-sbkm-navy dark:bg-white/10 dark:text-white">
          {props.icon}
        </div>
        <div className="grid max-w-sm gap-1">
          <p className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
            {props.title}
          </p>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/60">{props.description}</p>
        </div>
      </div>
    </DetailCard>
  );
}

function ReportSkeleton() {
  return (
    <DetailCard padding="none">
      <div className="grid gap-0">
        <div className="h-11 animate-dt-shimmer border-b border-sbkm-navy/8 bg-sbkm-navy/[0.03] dark:border-white/8 dark:bg-white/[0.03]" />
        <div className="min-h-[560px] animate-dt-shimmer bg-sbkm-navy/[0.04] dark:bg-white/[0.04]" />
      </div>
    </DetailCard>
  );
}

export function DtSeoReportDetail(props: {
  reportId: string;
  organisationIdFromUrl: string | null;
  isPlatformAdmin: boolean;
}) {
  const [report, setReport] = useState<DtSeoReportRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("report");

  const fetchReport = useCallback(async () => {
    const res = await fetch(`/api/dt/seo/reports/${encodeURIComponent(props.reportId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      message?: string;
      report?: DtSeoReportRow;
    };
    if (!res.ok || !json.ok || !json.report) {
      setLoadError(json.message ?? "Report nicht gefunden.");
      setReport(null);
      return false;
    }
    setLoadError(null);
    setReport(json.report);
    return true;
  }, [props.reportId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const ok = await fetchReport();
      if (!cancelled) setLoading(false);
      if (!ok) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchReport]);

  useEffect(() => {
    if (!report) return;
    const inProgress = report.state === "queued" || report.state === "running";
    if (!inProgress) return;

    const id = window.setInterval(() => {
      void fetchReport();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [report?.state, report, fetchReport]);

  const parsed = useMemo(
    () => parseSeoReportPayload(report?.payload),
    [report?.payload],
  );

  const orgId = report?.organisation_id ?? props.organisationIdFromUrl ?? "";
  const backHref = orgId
    ? `/dashboard/verwaltung/seo?org=${encodeURIComponent(orgId)}&tab=reports`
    : "/dashboard/verwaltung/seo?tab=reports";

  const recommendationCount =
    parsed.recommendations.length + parsed.keywordWatchlist.length;

  const tabs = useMemo(
    () => [
      { id: "report", label: "Bericht" },
      {
        id: "recommendations",
        label:
          recommendationCount > 0
            ? `Empfehlungen (${recommendationCount})`
            : "Empfehlungen",
      },
      { id: "details", label: "Details" },
    ],
    [recommendationCount],
  );

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="h-8 w-40 animate-dt-shimmer rounded bg-sbkm-navy/5 dark:bg-white/5" />
        <div className="h-28 animate-dt-shimmer rounded-dt-lg bg-sbkm-navy/5 dark:bg-white/5" />
        <ReportSkeleton />
      </div>
    );
  }

  if (loadError || !report) {
    return (
      <DetailCard>
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError ?? "Report nicht gefunden."}
        </p>
        <Link
          href={backHref}
          className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sbkm-mint transition-colors duration-150 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Zurück zu Reports
        </Link>
      </DetailCard>
    );
  }

  const inProgress = report.state === "queued" || report.state === "running";
  const isDone = report.state === "done";
  const isError = report.state === "error";
  const runtime = durationHint(report.started_at, report.finished_at);
  const hostname = reportHostname(report.url);

  const focusKeywords = parseKeywordList(report.focus_keyword);

  const detailsPanel = (
    <div className="grid min-w-0 gap-5">
      <DetailsSection
        icon={<Globe className="h-4 w-4" aria-hidden />}
        title="Report-Konfiguration"
        description="Website und Versand"
      >
        <dl className="min-w-0">
          <MetaField label="Website" value={report.url} href={report.url} />
          <MetaField label="Zeitraum" value={timeframeLabel(report.timeframe)} />
          <MetaField
            label="Empfänger"
            value={`${recipientTypeLabel(report.recipient_type)} · ${report.recipient_email}`}
          />
        </dl>
      </DetailsSection>

      <DetailsSection
        icon={<Plug className="h-4 w-4" aria-hidden />}
        title="Integrationen"
        description="Verbundene Analytics-Quellen"
      >
        <dl className="min-w-0">
          <MetaField label="GA4 Property" value={report.ga4_property_id} mono />
          <MetaField label="GSC Property" value={report.gsc_site_url} href={report.gsc_site_url} />
          <MetaField label="Sistrix Domain" value={report.sistrix_domain} mono />
        </dl>
      </DetailsSection>

      {focusKeywords.length > 0 ? (
        <DetailsSection
          icon={<Target className="h-4 w-4" aria-hidden />}
          title="Fokus-Keywords"
          description={`${focusKeywords.length} Keywords für diesen Report`}
        >
          <KeywordChipGrid keywords={focusKeywords} variant="mint" />
        </DetailsSection>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <DetailsSection
          icon={<Clock className="h-4 w-4" aria-hidden />}
          title="Zeitverlauf"
          description="Erstellung und Generierung"
        >
          <div className="py-1">
            <TimelineStep label="Erstellt" value={formatDateTime(report.created_at)} />
            <TimelineStep label="Gestartet" value={formatDateTime(report.started_at)} />
            <TimelineStep
              label="Abgeschlossen"
              value={formatDateTime(report.finished_at)}
              isLast={!parsed.generatedAt}
            />
            {parsed.generatedAt ? (
              <TimelineStep label="Generiert" value={formatDateTime(parsed.generatedAt)} isLast />
            ) : null}
            {runtime ? (
              <p className="mt-3 border-t border-sbkm-navy/6 pt-3 text-xs text-sbkm-ink-600 dark:border-white/6 dark:text-white/55">
                Laufzeit:{" "}
                <span className="font-semibold tabular-nums text-sbkm-navy dark:text-white">
                  {runtime}
                </span>
              </p>
            ) : null}
          </div>
        </DetailsSection>

        <div className="grid min-w-0 gap-5">
          {isDone && report.followup_due_at ? (
            <div className="relative overflow-hidden rounded-dt-lg border border-sbkm-mint/25 bg-sbkm-mint/10 p-5 dark:bg-sbkm-mint/12">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
                aria-hidden
              />
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-dt bg-sbkm-mint/20 text-sbkm-navy dark:text-white">
                  {report.followup_done ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                  ) : (
                    <Clock className="h-4 w-4" aria-hidden />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
                    Follow-up
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-sbkm-navy/90 dark:text-white/90">
                    Nächster Check: {formatDateTime(report.followup_due_at)}
                  </p>
                  <p
                    className={cn(
                      "mt-2 inline-flex rounded-pill px-2.5 py-0.5 text-xs font-semibold",
                      report.followup_done
                        ? "bg-sbkm-mint/25 text-sbkm-navy dark:text-white"
                        : "bg-sbkm-navy/8 text-sbkm-ink-600 dark:bg-white/10 dark:text-white/70",
                    )}
                  >
                    {report.followup_done ? "Erledigt" : "Ausstehend"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {parsed.keywordHighlights.length > 0 ? (
            <DetailsSection
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              title="Top-Keywords"
              description="Aus GSC-Daten im Report"
            >
              <KeywordChipGrid keywords={parsed.keywordHighlights} variant="neutral" />
            </DetailsSection>
          ) : null}
        </div>
      </div>

      {props.isPlatformAdmin && parsed.hasRaw ? (
        <details className="min-w-0 rounded-dt-lg border border-sbkm-navy/10 bg-sbkm-navy/[0.02] dark:border-white/10 dark:bg-white/[0.03]">
          <summary className="cursor-pointer px-5 py-3.5 text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 transition-colors duration-150 hover:text-sbkm-navy dark:text-white/55 dark:hover:text-white">
            Technische Details
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-sbkm-navy/8 p-4 text-[11px] leading-relaxed text-sbkm-ink-600 dark:border-white/8 dark:text-white/50">
            {JSON.stringify(report.payload?.raw ?? report.payload, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );

  return (
    <motion.div
      className="grid min-w-0 gap-6"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Link
        href={backHref}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-sbkm-ink-600 transition-colors duration-150 hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 dark:text-white/60 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Reports
      </Link>

      <DetailCard className="shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] dark:shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 grid gap-1.5">
            <p className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
              SEO-Report
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-sbkm-navy dark:text-white">
              {hostname}
            </h1>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/65">
              {timeframeLabel(report.timeframe)} · {formatDateTime(report.created_at)}
              {runtime ? ` · ${runtime}` : null}
              {report.recipient_email ? ` · ${report.recipient_email}` : null}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {parsed.kpis.length === 1 ? (
                <span className="inline-flex items-center rounded-pill bg-sbkm-mint/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-sbkm-navy dark:bg-sbkm-mint/20 dark:text-white">
                  {parsed.kpis[0].label}: {parsed.kpis[0].value}
                </span>
              ) : null}
              <Badge
                variant={isDone ? "secondary" : isError ? "destructive" : "outline"}
                className="tabular-nums"
              >
                {reportStateLabel(report.state)}
              </Badge>
            </div>
          </div>
        </div>

        {parsed.kpis.length > 1 ? (
          <motion.div
            className="mt-5 flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            variants={listStagger}
            initial="hidden"
            animate="show"
          >
            {parsed.kpis.map((kpi) => (
              <motion.div
                key={kpi.label}
                variants={listItem}
                className="min-w-[140px] shrink-0 rounded-dt border border-sbkm-navy/10 bg-sbkm-navy/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
                  {kpi.label}
                </p>
                <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-sbkm-navy dark:text-white">
                  {kpi.value}
                </p>
                {kpi.hint ? (
                  <p className="mt-0.5 text-xs text-sbkm-ink-600 dark:text-white/55">{kpi.hint}</p>
                ) : null}
              </motion.div>
            ))}
          </motion.div>
        ) : null}
      </DetailCard>

      {inProgress ? (
        <DetailCard className="border-sbkm-mint/30 bg-sbkm-mint/8 dark:bg-sbkm-mint/10">
          <div className="flex items-center gap-3">
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin text-sbkm-navy dark:text-white"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                Report wird erstellt …
              </p>
              <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
                Die Seite aktualisiert sich automatisch alle 15 Sekunden.
              </p>
            </div>
          </div>
        </DetailCard>
      ) : null}

      {isError && report.state_message ? (
        <div
          className="rounded-dt border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {report.state_message}
        </div>
      ) : null}

      <div className="min-w-0">
        <DtTabs
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
          layoutId="dt-seo-report-detail-tabs"
          className="mb-4"
        />

        {activeTab === "report" ? (
          <div className="grid gap-4">
            {parsed.summaryText ? (
              <DetailCard>
                <p className="text-sm leading-relaxed text-sbkm-navy dark:text-white/90">
                  {parsed.summaryText}
                </p>
              </DetailCard>
            ) : null}

            {inProgress && !parsed.reportHtml ? (
              <ReportSkeleton />
            ) : parsed.reportHtml ? (
              <DtSeoReportHtmlViewer html={parsed.reportHtml} title={hostname} />
            ) : isDone ? (
              <EmptyPanel
                icon={<FileText className="h-5 w-5" aria-hidden />}
                title="Kein HTML-Inhalt"
                description="Report abgeschlossen, aber kein HTML gespeichert — z. B. bei Legacy-Importen."
              />
            ) : (
              <EmptyPanel
                icon={<FileText className="h-5 w-5" aria-hidden />}
                title="Noch kein Inhalt"
                description="Sobald der Report fertig ist, erscheint der Inhalt hier."
              />
            )}
          </div>
        ) : activeTab === "details" ? (
          detailsPanel
        ) : parsed.recommendations.length === 0 && parsed.keywordWatchlist.length === 0 ? (
          <EmptyPanel
            icon={<Lightbulb className="h-5 w-5" aria-hidden />}
            title="Keine Empfehlungen"
            description="In diesem Report wurden keine Keywords oder Handlungsempfehlungen gespeichert."
          />
        ) : (
          <div className="grid gap-4">
            {parsed.keywordWatchlist.length > 0 ? (
              <DetailCard>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                    Top-Keywords (Search Console)
                  </p>
                  <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/50">
                    Ranking-Übersicht zur Beobachtung — keine automatischen Aufgaben.
                  </p>
                </div>
                <motion.ol
                  className="grid gap-2"
                  variants={listStagger}
                  initial="hidden"
                  animate="show"
                >
                  {parsed.keywordWatchlist.map((item, i) => (
                    <motion.li
                      key={`${i}-${item.keyword}`}
                      variants={listItem}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-dt border border-sbkm-navy/8 bg-sbkm-navy/[0.02] px-4 py-3 dark:border-white/8 dark:bg-white/[0.03]"
                    >
                      <span className="text-sm font-semibold text-sbkm-navy dark:text-white">
                        {item.keyword}
                      </span>
                      <span className="text-xs tabular-nums text-sbkm-ink-600 dark:text-white/55">
                        {[
                          item.position ? `Pos. ${item.position}` : null,
                          item.impressions ? `${item.impressions} Impr.` : null,
                          item.clicks ? `${item.clicks} Klicks` : null,
                          item.trend ? item.trend : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </motion.li>
                  ))}
                </motion.ol>
              </DetailCard>
            ) : null}

            {parsed.recommendations.length > 0 ? (
              <DetailCard>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
                    Handlungsempfehlungen
                  </p>
                  <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/50">
                    Nur Einträge mit konkreter Maßnahme werden als{" "}
                    <Link
                      href={`/dashboard/verwaltung/seo?org=${encodeURIComponent(orgId)}&tab=tasks`}
                      className="font-semibold text-sbkm-mint transition-colors duration-150 hover:text-sbkm-navy dark:hover:text-white"
                    >
                      Aufgaben
                    </Link>{" "}
                    übernommen.
                  </p>
                </div>
                <motion.ol
                  className="grid gap-3"
                  variants={listStagger}
                  initial="hidden"
                  animate="show"
                >
                  {parsed.recommendations.map((rec, i) => (
                    <motion.li
                      key={`${i}-${rec.title}`}
                      variants={listItem}
                      className="rounded-dt border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-sbkm-navy/12 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] dark:border-white/8 dark:bg-white/[0.03] dark:hover:border-white/12 dark:hover:shadow-none"
                    >
                      <span className="text-[11px] font-bold tabular-nums text-sbkm-mint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="mt-1 text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">
                        {rec.title}
                      </p>
                      {rec.keyword ? (
                        <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/50">
                          Keyword: {rec.keyword}
                          {rec.currentStatus ? ` · ${rec.currentStatus}` : ""}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-sbkm-ink-600 dark:text-white/60">
                        {rec.action}
                      </p>
                    </motion.li>
                  ))}
                </motion.ol>
              </DetailCard>
            ) : null}
          </div>
        )}
      </div>
    </motion.div>
  );
}
