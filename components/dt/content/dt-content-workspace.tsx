"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/components/dt/cn";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { DtSelect } from "@/components/dt/dt-select";
import { contentApi, contentQuery } from "@/components/dt/content/content-api";
import { DtContentPageDrawer } from "@/components/dt/content/dt-content-page-drawer";
import {
  DtContentPagesTable,
  isContentPageSelectable,
} from "@/components/dt/content/dt-content-pages-table";
import { DtContentReadinessCard } from "@/components/dt/content/dt-content-readiness-card";
import type { ContentAvatarOption } from "@/lib/dt/content/load-sources";
import { anyContentPageRunning, formatContentDate } from "@/lib/dt/content/presentation";
import type {
  ContentClientPutBody,
  ContentClientPutResult,
  ContentLocalSources,
  ContentOverview,
  ContentReadiness,
  ContentRunThroughResult,
} from "@/lib/dt/content/types";

const POLL_MS = 10_000;

const cardClass =
  "relative overflow-hidden rounded-dt-lg border border-sbkm-navy/10 bg-white/55 shadow-dt backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.05]";

function SummaryChip(props: { value: string | number; label: string; tone?: "orange" }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-pill border px-3 py-1",
        props.tone === "orange"
          ? "border-orange-300/70 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-100"
          : "border-sbkm-navy/10 bg-white/60 text-sbkm-navy dark:border-white/10 dark:bg-white/[0.04] dark:text-white",
      )}
    >
      <span className="text-sm font-bold tabular-nums">{props.value}</span>
      <span className="text-xs opacity-75">{props.label}</span>
    </span>
  );
}

export function DtContentWorkspace(props: {
  organisationId: string;
  avatars: ContentAvatarOption[];
  initialDemo: boolean;
}) {
  const { organisationId } = props;
  const [demo, setDemo] = useState(props.initialDemo);

  const [readiness, setReadiness] = useState<ContentReadiness | null>(null);
  const [local, setLocal] = useState<ContentLocalSources | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const [overview, setOverview] = useState<ContentOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [avatarId, setAvatarId] = useState(props.avatars[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<{ result: ContentClientPutResult; sent: ContentClientPutBody } | null>(null);
  const [openPage, setOpenPage] = useState<{ slug: string; name: string } | null>(null);

  const loadReadiness = useCallback(async () => {
    setReadinessLoading(true);
    const res = await contentApi<{ readiness: ContentReadiness; local: ContentLocalSources }>(
      `/api/dt/content/readiness?${contentQuery(organisationId)}`,
    );
    if (res.ok) {
      setReadiness(res.data.readiness);
      setLocal(res.data.local);
      setReadinessError(null);
      setDemo(res.demo);
    } else {
      setReadinessError(res.message);
    }
    setReadinessLoading(false);
  }, [organisationId]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    const res = await contentApi<ContentOverview>(
      `/api/dt/content/overview?${contentQuery(organisationId)}`,
    );
    if (res.ok) {
      setOverview(res.data);
      setOverviewError(null);
      setDemo(res.demo);
      setRefreshedAt(new Date().toISOString());
      setSelected((prev) => {
        const allowed = new Set(res.data.pages.filter(isContentPageSelectable).map((p) => p.slug));
        const next = new Set([...prev].filter((slug) => allowed.has(slug)));
        return next.size === prev.size ? prev : next;
      });
    } else {
      setOverviewError(res.message);
    }
    setOverviewLoading(false);
  }, [organisationId]);

  useEffect(() => {
    void loadReadiness();
    void loadOverview();
  }, [loadReadiness, loadOverview]);

  const running = overview ? anyContentPageRunning(overview.pages) : false;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOverview();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, loadOverview]);

  const avatarOptions = useMemo(
    () =>
      props.avatars.map((a, index) => ({
        value: a.id,
        label: a.name,
        description: [a.role, index === 0 ? "neuester" : formatContentDate(a.createdAt).slice(0, 10)]
          .filter(Boolean)
          .join(" · "),
      })),
    [props.avatars],
  );

  const pages = overview?.pages ?? [];
  const selectedCount = selected.size;
  const notReady = readiness ? !readiness.ready : false;

  async function startTexts() {
    if (selectedCount === 0 || starting) return;
    setStarting(true);
    const res = await contentApi<ContentRunThroughResult>("/api/dt/content/run-through", {
      method: "POST",
      body: { organisationId, pages: [...selected] },
    });
    setStarting(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const started = res.data.jobs.length;
    const skipped = res.data.skipped;
    const head =
      started > 0
        ? `${started} ${started === 1 ? "Seite" : "Seiten"} gestartet`
        : "Keine Seite gestartet";
    toast.success(res.demo ? `${head} (Demo – nichts wurde gestartet)` : head, {
      description:
        skipped.length > 0
          ? skipped.map((s) => `${s.page}: ${s.reason}`).join(" · ")
          : undefined,
    });
    setSelected(new Set());
    void loadOverview();
  }

  async function syncSources() {
    if (syncing) return;
    setSyncing(true);
    const res = await contentApi<{ result: ContentClientPutResult; sent: ContentClientPutBody }>(
      "/api/dt/content/client",
      { method: "PUT", body: { organisationId, agentId: avatarId || null } },
    );
    setSyncing(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setSync(res.data);
    const { result } = res.data;
    if (result.problems.length > 0) {
      toast.warning("Übertragen, aber nicht vollständig", { description: result.problems.join(" · ") });
    } else {
      toast.success(res.demo ? "Übertragen (Demo – nichts gespeichert)" : "Daten übertragen");
    }
    void loadReadiness();
    void loadOverview();
  }

  return (
    <div className="grid gap-5">
      <DtContentReadinessCard
        organisationId={organisationId}
        readiness={readiness}
        local={local}
        loading={readinessLoading}
        error={readinessError}
      />

      <section className={cn(cardClass, "grid gap-4 p-4 sm:p-5")} aria-label="Texte erstellen">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <DtSelect
              label="Avatar"
              value={avatarId}
              onValueChange={setAvatarId}
              options={avatarOptions}
              placeholder="Kein Avatar vorhanden"
              disabled={avatarOptions.length === 0}
              className="sm:w-72"
              fullWidth
            />
            <DtPillButton
              type="button"
              size="sm"
              variant="outline"
              className="h-10"
              disabled={syncing}
              onClick={() => void syncSources()}
              title="Anbieterfakten und den gewählten Avatar an den Content-Agent schicken"
            >
              {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
              Daten übertragen
            </DtPillButton>
          </div>
          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <DtPillButton
              type="button"
              className="h-11"
              disabled={selectedCount === 0 || starting || notReady}
              onClick={() => void startTexts()}
            >
              {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              Texte erstellen ({selectedCount})
            </DtPillButton>
            <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
              {notReady
                ? "Erst alle drei Voraussetzungen oben erfüllen."
                : selectedCount === 0
                  ? "Seiten in der Tabelle anhaken."
                  : "Der Content-Agent meldet sich, wenn er Sie braucht."}
            </p>
          </div>
        </div>

        {sync ? (
          <details className="group rounded-xl border border-sbkm-navy/8 bg-sbkm-navy/[0.02] text-xs dark:border-white/8 dark:bg-white/[0.03]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-sbkm-ink-600 dark:text-white/65">
              <span>
                Übertragen: Anbieterfakten {sync.result.anbieter ? "✓" : "—"} · Avatar{" "}
                {sync.result.avatar ? "✓" : "—"}
                {sync.result.problems.length > 0 ? ` · ${sync.result.problems.length} Hinweis(e)` : ""}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-sbkm-navy dark:text-white">
                Gesendete Daten
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="grid gap-2 border-t border-sbkm-navy/8 px-3 py-2 dark:border-white/8">
              {sync.result.problems.length > 0 ? (
                <ul className="list-disc pl-4 text-orange-800 dark:text-orange-200">
                  {sync.result.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2.5 font-mono text-[11px] leading-relaxed text-sbkm-navy scrollbar-subtle dark:bg-black/20 dark:text-white/80">
                {JSON.stringify(sync.sent, null, 2)}
              </pre>
            </div>
          </details>
        ) : null}
      </section>

      <section className={cardClass} aria-label="Seiten">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sbkm-navy/8 px-4 py-3.5 dark:border-white/8 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-sm font-semibold tracking-tight text-sbkm-navy dark:text-white">Seiten</h2>
            {overview ? (
              <>
                {overview.needs_you > 0 ? (
                  <SummaryChip value={overview.needs_you} label="brauchen Sie" tone="orange" />
                ) : null}
                <SummaryChip value={overview.finished} label="fertig" />
                {overview.running > 0 ? <SummaryChip value={overview.running} label="laufen" /> : null}
                <SummaryChip value={overview.cost} label="Kosten gesamt" />
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-sbkm-ink-500 dark:text-white/45">
            {running ? <span>Aktualisiert sich alle 10 Sekunden</span> : null}
            <button
              type="button"
              onClick={() => void loadOverview()}
              disabled={overviewLoading}
              className="inline-flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-sbkm-navy/[0.06] hover:text-sbkm-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sbkm-mint/45 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Neu laden"
              title={refreshedAt ? `Zuletzt geladen: ${formatContentDate(refreshedAt)}` : "Neu laden"}
            >
              <RefreshCw className={cn("size-3.5", overviewLoading && "animate-spin")} aria-hidden />
            </button>
          </div>
        </header>
        <div className="p-2 sm:p-3">
          {overviewError ? (
            <p className="px-2 py-3 text-sm text-red-700 dark:text-red-300">{overviewError}</p>
          ) : !overview && overviewLoading ? (
            <div className="grid gap-2 p-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-sbkm-navy/[0.05] dark:bg-white/[0.05]" />
              ))}
            </div>
          ) : (
            <DtContentPagesTable
              pages={pages}
              selected={selected}
              onToggle={(slug) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(slug)) next.delete(slug);
                  else next.add(slug);
                  return next;
                })
              }
              onToggleAll={(checked) =>
                setSelected(
                  checked ? new Set(pages.filter(isContentPageSelectable).map((p) => p.slug)) : new Set(),
                )
              }
              onOpen={(page) => setOpenPage({ slug: page.slug, name: page.name })}
            />
          )}
        </div>
      </section>

      <DtContentPageDrawer
        organisationId={organisationId}
        page={openPage}
        open={openPage != null}
        demo={demo}
        onClose={() => setOpenPage(null)}
        onChanged={() => void loadOverview()}
      />
    </div>
  );
}
