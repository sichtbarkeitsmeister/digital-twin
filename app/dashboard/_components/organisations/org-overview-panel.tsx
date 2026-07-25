"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  ExternalLink,
  Globe,
  MessageCircle,
  Sparkles,
  Zap,
} from "lucide-react";

import { formatOrgDate } from "@/lib/dashboard/organisation-ui";
import type { OrgOverview } from "@/lib/dashboard/org-overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { OrgSeoReportModal } from "@/app/dashboard/_components/organisations/org-seo-report-modal";
import { OrgSeoReportsList } from "@/app/dashboard/_components/organisations/org-seo-reports-list";
import { filterAgentsHiddenFromOrgMembers } from "@/lib/dt/agents/seo-advisor";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const item = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export const orgDetailCardClass =
  "relative overflow-hidden rounded-2xl border border-sbkm-navy/10 bg-white/55 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("de-DE").format(n);
}

function crawlStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Warteschlange";
    case "running":
      return "Läuft";
    case "done":
      return "Fertig";
    case "error":
      return "Fehler";
    case "cancelled":
      return "Abgebrochen";
    default:
      return status;
  }
}

function agentKindLabel(kind: string): string | null {
  switch (kind) {
    case "seo_advisor":
      return "SEO";
    case "persona":
      return null;
    default:
      return kind.replace(/_/g, " ");
  }
}

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function OverviewCard(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(orgDetailCardClass, "transition-all duration-200", props.className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      {props.children}
    </div>
  );
}

function CardHeaderRow(props: {
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 sm:px-5 dark:border-white/8">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-primary">{props.title}</h3>
        {props.description ? (
          <p className="mt-0.5 text-xs text-secondary">{props.description}</p>
        ) : null}
      </div>
      {props.href && props.linkLabel ? (
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 text-xs font-semibold transition-transform duration-150 active:scale-[0.98]"
        >
          <Link href={props.href}>
            {props.linkLabel}
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function StatPill(props: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-pill border border-sbkm-navy/10 bg-white/50 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]">
      <span className="text-sm font-semibold tabular-nums tracking-tight text-primary">
        {props.value}
      </span>
      <span className="text-xs text-secondary">{props.label}</span>
    </div>
  );
}

function MiniSparkline(props: {
  data: Array<{ date: string; totalTokens: number }>;
}) {
  if (props.data.length === 0) return null;
  const max = Math.max(1, ...props.data.map((d) => d.totalTokens));
  return (
    <div className="grid gap-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-secondary">
        Verlauf (30 T.)
      </p>
      <div className="flex h-10 items-end gap-0.5 rounded-xl bg-sbkm-navy/[0.03] px-2 py-2 dark:bg-white/[0.03]" aria-hidden>
        {props.data.map((d) => (
          <div
            key={d.date}
            className="min-w-[3px] flex-1 rounded-sm bg-sbkm-mint/70 dark:bg-sbkm-mint/40"
            style={{ height: `${Math.max(10, (d.totalTokens / max) * 100)}%` }}
            title={`${d.date}: ${formatTokens(d.totalTokens)}`}
          />
        ))}
      </div>
    </div>
  );
}

function MetricCell(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] px-3 py-2.5 dark:border-white/8 dark:bg-white/[0.03]">
      <p className="text-[10px] font-medium uppercase tracking-wide text-secondary">
        {props.label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-primary">
        {props.value}
      </p>
    </div>
  );
}

export function OrgOverviewPanel(props: {
  organisationId: string;
  overview: OrgOverview;
  memberCount: number;
  pendingInviteCount: number;
  canViewUsage: boolean;
  canViewSeoReports?: boolean;
  canManageSeo?: boolean;
  canViewSeoAdvisor?: boolean;
  /** Hide SEO Modus link when the page header already shows it */
  hideSeoCta?: boolean;
}) {
  const { overview, organisationId } = props;
  const canViewSeoReports = props.canViewSeoReports ?? false;
  const canManageSeo = props.canManageSeo ?? false;
  const canViewSeoAdvisor = props.canViewSeoAdvisor ?? false;
  const router = useRouter();
  const [reportModalId, setReportModalId] = useState<string | null>(null);
  const [seoEnabled, setSeoEnabled] = useState(overview.config.seoEnabled);
  const [enablingSeo, setEnablingSeo] = useState(false);
  const [seoEnableError, setSeoEnableError] = useState<string | null>(null);

  useEffect(() => {
    setSeoEnabled(overview.config.seoEnabled);
  }, [overview.config.seoEnabled]);

  async function enableSeoNow() {
    if (!canManageSeo || enablingSeo) return;
    setEnablingSeo(true);
    setSeoEnableError(null);
    try {
      const res = await fetch(`/api/dt/org-config/${organisationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seoEnabled: true }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!json.ok) {
        setSeoEnableError(json.message ?? "Aktivierung fehlgeschlagen.");
        return;
      }
      setSeoEnabled(true);
      router.refresh();
    } catch (err) {
      setSeoEnableError(err instanceof Error ? err.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setEnablingSeo(false);
    }
  }
  const openSeoTasks = overview.seoTasks.open + overview.seoTasks.inProgress;
  const visibleAgents = canViewSeoAdvisor
    ? overview.agents
    : filterAgentsHiddenFromOrgMembers(overview.agents);
  const enabledAgents = visibleAgents.filter((a) => a.isEnabled);
  const orgQuery = encodeURIComponent(organisationId);
  const seoHref = `/dashboard/verwaltung/seo?org=${orgQuery}&tab=chat`;

  const hasSeoData =
    overview.seoReport != null || overview.seoMonthly.periodMonth != null;
  const hasSeoMonthly = overview.seoMonthly.periodMonth != null;
  const usageEmpty =
    props.canViewUsage && overview.usage && overview.usage.messages === 0;

  const fourthStat = props.canViewUsage && overview.usage
    ? { value: formatTokens(overview.usage.totalTokens), label: "Tokens (30 T.)" }
    : { value: overview.chatCount, label: "Chats" };

  return (
    <motion.section
      className="grid gap-4"
      variants={container}
      initial="hidden"
      animate="show"
      aria-label="Organisationsübersicht"
    >
      <motion.div variants={item} className="flex flex-wrap items-center gap-2">
        <StatPill label="Mitglieder" value={props.memberCount} />
        <StatPill label="Agenten" value={enabledAgents.length} />
        <StatPill label="SEO-Aufgaben" value={openSeoTasks} />
        <StatPill label={fourthStat.label} value={fourthStat.value} />
      </motion.div>

      <motion.div variants={item}>
        <OverviewCard>
          <CardHeaderRow
            title="SEO"
            description="Reports, Aufgaben und Kennzahlen"
            href={props.hideSeoCta || !canManageSeo ? undefined : seoHref}
            linkLabel={props.hideSeoCta || !canManageSeo ? undefined : "SEO Modus"}
          />
          <div className="grid gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              {seoEnabled ? (
                <Badge className="bg-sbkm-navy text-white dark:bg-sbkm-mint dark:text-sbkm-navy">
                  Aktiv
                </Badge>
              ) : (
                <>
                  <Badge variant="outline">Inaktiv</Badge>
                  {canManageSeo ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={enablingSeo}
                      className="h-7 active:scale-[0.98]"
                      onClick={() => void enableSeoNow()}
                    >
                      {enablingSeo ? "Aktiviere…" : "SEO aktivieren"}
                    </Button>
                  ) : null}
                </>
              )}
              {seoEnableError ? (
                <span className="text-xs text-red-600 dark:text-red-400">{seoEnableError}</span>
              ) : null}
              {overview.config.websiteUrl ? (
                <a
                  href={overview.config.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-sbkm-navy/[0.04] dark:hover:bg-white/5"
                >
                  <Globe className="size-3" aria-hidden />
                  Website
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
              {overview.config.ga4Connected ? (
                <Badge variant="secondary" className="text-[10px]">
                  GA4
                </Badge>
              ) : null}
              {overview.config.gscConnected ? (
                <Badge variant="secondary" className="text-[10px]">
                  GSC
                </Badge>
              ) : null}
              {overview.config.focusKeyword ? (
                <span
                  className="max-w-xs truncate text-xs text-secondary"
                  title={overview.config.focusKeyword}
                >
                  Fokus:{" "}
                  <span className="font-medium text-primary">
                    {overview.config.focusKeyword}
                  </span>
                </span>
              ) : null}
            </div>

            {!hasSeoData ? (
              <div className="grid gap-3 rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-10 text-center dark:border-white/15">
                <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-sbkm-mint/15 dark:bg-sbkm-mint/10">
                  <Sparkles className="size-5 text-sbkm-navy dark:text-sbkm-mint" aria-hidden />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-semibold tracking-tight text-primary">
                    Noch keine SEO-Daten
                  </p>
                  <p className="mx-auto max-w-sm text-xs text-secondary">
                    {canManageSeo
                      ? "Starte im SEO Modus einen Report oder Crawl — Kennzahlen und Maßnahmen erscheinen dann hier."
                      : canViewSeoReports
                        ? "Sobald ein SEO-Report für deine Organisation fertig ist, findest du ihn hier."
                        : "SEO-Reports werden vom Team erstellt und erscheinen hier, sobald sie verfügbar sind."}
                  </p>
                </div>
                {canManageSeo ? (
                  <Button asChild size="sm" className="mx-auto w-fit active:scale-[0.98]">
                    <Link href={seoHref}>
                      SEO Modus öffnen
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <div
                className={cn(
                  "grid gap-4",
                  hasSeoMonthly && "lg:grid-cols-2 lg:items-start",
                )}
              >
                <div className="grid gap-3">
                  {overview.seoReport ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] p-3 sm:flex-row sm:items-start sm:justify-between dark:border-white/8 dark:bg-white/[0.03]">
                      <div className="min-w-0 grid gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-primary">Letzter Report</span>
                          <Badge
                            variant={
                              overview.seoReport.state === "done" ? "secondary" : "outline"
                            }
                          >
                            {overview.seoReport.stateLabel}
                          </Badge>
                        </div>
                        <p className="text-xs text-secondary">
                          {formatOrgDate(
                            overview.seoReport.finishedAt ?? overview.seoReport.createdAt,
                          )}
                          {overview.seoReport.actionCount > 0
                            ? ` · ${overview.seoReport.actionCount} Maßnahme${overview.seoReport.actionCount === 1 ? "" : "n"}`
                            : ""}
                        </p>
                        {overview.seoReport.ownerDelivery ? (
                          <p className="text-xs text-secondary">
                            {overview.seoReport.ownerDelivery.label}
                          </p>
                        ) : null}
                      </div>
                      {overview.seoReport.state === "done" && canViewSeoReports ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 transition-transform duration-150 active:scale-[0.98]"
                          onClick={() => setReportModalId(overview.seoReport!.id)}
                        >
                          Report ansehen
                          <ArrowRight className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {canViewSeoReports ? (
                    <OrgSeoReportsList
                      organisationId={organisationId}
                      excludeReportId={overview.seoReport?.id}
                      onOpenReport={setReportModalId}
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {overview.seoTasks.total > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {overview.seoTasks.open > 0 ? (
                          <span className="rounded-pill bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                            {overview.seoTasks.open} offen
                          </span>
                        ) : null}
                        {overview.seoTasks.inProgress > 0 ? (
                          <span className="rounded-pill bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-900 dark:bg-blue-500/15 dark:text-blue-200">
                            {overview.seoTasks.inProgress} in Arbeit
                          </span>
                        ) : null}
                        {overview.seoTasks.done > 0 ? (
                          <span className="rounded-pill bg-muted px-2.5 py-1 text-xs font-medium text-secondary">
                            {overview.seoTasks.done} erledigt
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {overview.lastCrawl ? (
                      <p className="text-xs text-secondary">
                        Crawl: {crawlStatusLabel(overview.lastCrawl.status)}
                        {overview.lastCrawl.pagesCrawled > 0
                          ? ` · ${overview.lastCrawl.pagesCrawled} Seiten`
                          : ""}
                        {overview.lastCrawl.finishedAt
                          ? ` · ${formatOrgDate(overview.lastCrawl.finishedAt)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </div>

                {hasSeoMonthly ? (
                  <div className="grid gap-2">
                    <p className="text-xs font-medium text-primary">
                      {formatOrgDate(`${overview.seoMonthly.periodMonth}T12:00:00`)}
                      {overview.seoMonthly.aiClicksMomPct != null ? (
                        <span
                          className={cn(
                            "ml-2 tabular-nums",
                            overview.seoMonthly.aiClicksMomPct >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400",
                          )}
                        >
                          MoM {overview.seoMonthly.aiClicksMomPct >= 0 ? "+" : ""}
                          {overview.seoMonthly.aiClicksMomPct}%
                        </span>
                      ) : null}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <MetricCell label="KI-Klicks" value={overview.seoMonthly.aiClicks ?? "—"} />
                      <MetricCell
                        label="Gesamt-Klicks"
                        value={overview.seoMonthly.totalClicks ?? "—"}
                      />
                      <MetricCell
                        label="Impressionen"
                        value={overview.seoMonthly.impressions ?? "—"}
                      />
                      <MetricCell label="Top 10" value={overview.seoMonthly.rankingsTop10 ?? "—"} />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </OverviewCard>
      </motion.div>

      <motion.div variants={item} className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {props.canViewUsage && overview.usage && !usageEmpty ? (
          <OverviewCard>
            <CardHeaderRow
              title="Token-Nutzung"
              description="Letzte 30 Tage"
              href={`/dashboard/verwaltung/usage?org=${orgQuery}`}
              linkLabel="Details"
            />
            <div className="grid gap-4 p-4 sm:p-5">
              <div className="grid grid-cols-3 gap-2">
                <MetricCell label="Tokens" value={formatTokens(overview.usage.totalTokens)} />
                <MetricCell label="Nachrichten" value={overview.usage.messages} />
                <MetricCell
                  label="Ø / Nachricht"
                  value={formatTokens(overview.usage.avgTokensPerMessage)}
                />
              </div>
              <MiniSparkline data={overview.usage.byDay} />
              <div className="grid gap-1 text-xs text-secondary">
                {overview.usage.topAgent ? (
                  <p>
                    Top-Agent:{" "}
                    <span className="font-medium text-primary">
                      {overview.usage.topAgent.name}
                    </span>{" "}
                    ({formatTokens(overview.usage.topAgent.totalTokens)})
                  </p>
                ) : null}
                {overview.usage.topUser ? (
                  <p>
                    Top-Nutzer:{" "}
                    <span className="font-medium text-primary">
                      {overview.usage.topUser.email ?? overview.usage.topUser.id}
                    </span>{" "}
                    ({formatTokens(overview.usage.topUser.totalTokens)})
                  </p>
                ) : null}
              </div>
            </div>
          </OverviewCard>
        ) : (
          <OverviewCard>
            <CardHeaderRow title="Aktivität" description="Chats und Nutzung" />
            <div className="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-sbkm-mint/15 dark:bg-sbkm-mint/10">
                  <MessageCircle
                    className="size-4 text-sbkm-navy dark:text-sbkm-mint"
                    aria-hidden
                  />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight">
                    {overview.chatCount}
                  </p>
                  <p className="text-xs text-secondary">Chats gesamt</p>
                </div>
              </div>
              <p className="max-w-[12rem] text-right text-xs text-secondary">
                {!props.canViewUsage
                  ? "Token-Nutzung nur für Inhaber und Admins."
                  : "Noch keine Token-Nutzung in den letzten 30 Tagen."}
              </p>
            </div>
          </OverviewCard>
        )}

        <OverviewCard>
          <CardHeaderRow
            title="Agenten"
            description={`${enabledAgents.length} aktiv`}
            href={`/dashboard/verwaltung/agents?org=${orgQuery}`}
            linkLabel="Verwalten"
          />
          <div className="p-4 sm:p-5">
            {enabledAgents.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {enabledAgents.slice(0, 6).map((agent) => {
                    const kind = agentKindLabel(agent.kind);
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center gap-2.5 rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] px-2.5 py-2 transition-colors duration-150 hover:bg-sbkm-navy/[0.04] dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sbkm-navy/10 text-[10px] font-semibold text-sbkm-navy dark:bg-white/10 dark:text-white">
                          {agentInitials(agent.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-tight text-primary">
                            {agent.name}
                          </p>
                          {kind || agent.isDefault ? (
                            <p className="truncate text-[11px] leading-tight text-secondary">
                              {[kind, agent.isDefault ? "Standard" : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {enabledAgents.length > 6 ? (
                  <p className="mt-2.5 text-xs text-secondary">
                    +{enabledAgents.length - 6} weitere Agenten
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-dashed border-sbkm-navy/15 px-4 py-4 dark:border-white/15">
                <Bot className="size-5 shrink-0 text-secondary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">Keine aktiven Agenten</p>
                  <p className="text-xs text-secondary">
                    Lege Agenten an, damit Nutzer im Chat starten können.
                  </p>
                </div>
              </div>
            )}
          </div>
        </OverviewCard>
      </motion.div>

      {props.pendingInviteCount > 0 ? (
        <motion.p variants={item} className="text-xs tabular-nums text-amber-700 dark:text-amber-300">
          {props.pendingInviteCount} offene Einladung{props.pendingInviteCount === 1 ? "" : "en"}
        </motion.p>
      ) : null}

      <OrgSeoReportModal
        open={reportModalId != null}
        reportId={reportModalId}
        onClose={() => setReportModalId(null)}
      />
    </motion.section>
  );
}

export function OrgDetailSection(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="border-b border-sbkm-navy/8 pb-3 dark:border-white/8">
        <h2 className="text-sm font-semibold tracking-tight text-primary">{props.title}</h2>
        {props.description ? (
          <p className="mt-0.5 text-xs text-secondary">{props.description}</p>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}
