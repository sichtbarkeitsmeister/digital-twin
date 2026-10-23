"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Radar } from "lucide-react";
import { toast } from "sonner";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/dt/cn";
import { DtSeoGroundingCheckDetail } from "@/components/dt/seo/dt-seo-grounding-check-detail";
import type { GroundingRunDetail, GroundingRunSummary } from "@/lib/dt/seo/grounding-check/store";

/**
 * „Website prüfen“ in SEO Modus → Grounding: reads the website, compares it with the
 * grounding page and, when needed, leaves a draft (grounding.html + llms.txt) for review.
 * Nothing is published; a platform admin approves, downloads and uploads by hand.
 */

type Headline = { label: string; tone: "ok" | "warn" | "info" | "error" | "running" };

type RunsPayload = {
  ok?: boolean;
  message?: string;
  migrationMissing?: boolean;
  runs?: GroundingRunSummary[];
  detail?: GroundingRunDetail | null;
  headline?: Headline;
  viewerName?: string;
};

const POLL_MS = 5_000;
const LABEL_CLASS = "text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50";

const TONE_CLASS: Record<Headline["tone"], string> = {
  ok: "bg-sbkm-mint/25 text-sbkm-navy dark:text-sbkm-mint",
  warn: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  info: "border-sbkm-navy/15 bg-white/60 text-sbkm-ink-600 dark:border-white/15 dark:bg-white/5 dark:text-white/60",
  error: "border-red-400/50 bg-red-500/10 text-red-800 dark:text-red-200",
  running: "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-100",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DtSeoGroundingCheckCard(props: {
  organisationId: string;
  canEdit: boolean;
  /** The hub's dates changed (after „Als hochgeladen markieren“). */
  onPagesChanged?: () => void;
}) {
  const [runs, setRuns] = useState<GroundingRunSummary[]>([]);
  const [detail, setDetail] = useState<GroundingRunDetail | null>(null);
  const [headline, setHeadline] = useState<Headline | null>(null);
  const [viewerName, setViewerName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setLoading(true);
      try {
        const params = new URLSearchParams({ org: props.organisationId });
        if (selectedId) params.set("run", selectedId);
        const res = await fetch(`/api/dt/seo/grounding/runs?${params.toString()}`);
        const json = (await res.json().catch(() => ({}))) as RunsPayload;
        if (!res.ok || !json.ok) {
          setError(json.message ?? "Prüfungen konnten nicht geladen werden.");
          return;
        }
        setError(null);
        setRuns(json.runs ?? []);
        setDetail(json.detail ?? null);
        setHeadline(json.headline ?? null);
        setViewerName(json.viewerName ?? "");
      } catch {
        if (!opts.quiet) setError("Prüfungen konnten nicht geladen werden.");
      } finally {
        if (!opts.quiet) setLoading(false);
      }
    },
    [props.organisationId, selectedId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const latest = runs[0] ?? null;
  const running = latest?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load({ quiet: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  async function start(replaceDraft = false) {
    setStarting(true);
    try {
      const res = await fetch("/api/dt/seo/grounding/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: props.organisationId, replaceDraft }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string };
      if (res.status === 409 && json.code === "open_draft") {
        if (window.confirm(`${json.message ?? "Ein Entwurf wartet noch auf Prüfung."} Trotzdem neu prüfen?`)) await start(true);
        return;
      }
      if (!res.ok || !json.ok) {
        toast.error(json.message ?? "Prüfung konnte nicht gestartet werden.");
        return;
      }
      toast.success("Prüfung gestartet. Das dauert einige Minuten.");
      setSelectedId(null);
      await load({ quiet: true });
    } catch {
      toast.error("Prüfung konnte nicht gestartet werden.");
    } finally {
      setStarting(false);
    }
  }

  const onRun = useCallback((run: GroundingRunDetail) => {
    setDetail(run);
    setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, ...run } : r)));
    void load({ quiet: true });
  }, [load]);

  const shown = detail;
  const showingLatest = !selectedId || selectedId === latest?.id;

  return (
    <DtGlassCard variant="subtle" padding="none" className="grid gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">Website-Abgleich</h3>
          <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
            Liest die Website (Impressum, Kontakt, Über uns, Team, Leistungen, Standorte, FAQ), vergleicht ihre Fakten mit der Grounding Page
            und erstellt bei Bedarf einen Entwurf nach Standard v1.7 (grounding.html und llms.txt). Veröffentlicht wird nichts: Sie prüfen,
            geben frei, laden herunter und laden von Hand hoch.
          </p>
        </div>
        {headline ? (
          <Badge variant="outline" className={cn("shrink-0", TONE_CLASS[headline.tone])}>
            {headline.label}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {props.canEdit ? (
          <DtPillButton type="button" size="sm" disabled={starting || running} onClick={() => void start()} className="gap-1.5">
            {starting || running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Radar className="size-4" aria-hidden />}
            {running ? "Prüfung läuft …" : "Website prüfen"}
          </DtPillButton>
        ) : null}
        {latest ? (
          <p className="text-xs text-sbkm-ink-600 dark:text-white/55">
            Letzte Prüfung {formatDateTime(latest.createdAt)} ({latest.triggerLabel})
            {latest.status === "running" ? ` · ${latest.stepLabel}` : latest.decisionLabel ? ` · ${latest.decisionLabel}` : ""}
          </p>
        ) : null}
      </div>
      {running && latest?.error ? (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">Neuer Versuch folgt: {latest.error}</p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-sbkm-ink-600 dark:text-white/60">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Lade Prüfungen …
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : shown && shown.status !== "running" ? (
        <div className="grid gap-3 border-t border-sbkm-navy/10 pt-3 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2 text-xs text-sbkm-ink-600 dark:text-white/55">
            <Badge variant="outline">{shown.statusLabel}</Badge>
            {shown.decisionLabel ? <Badge variant="outline">{shown.decisionLabel}</Badge> : null}
            <span>
              {formatDateTime(shown.createdAt)} · {shown.triggerLabel}
              {shown.groundingUrl ? ` · ${shown.groundingUrl}` : ""}
              {shown.costEur > 0 ? ` · ${shown.costEur.toFixed(2).replace(".", ",")} €` : ""}
            </span>
            {!showingLatest ? (
              <button type="button" className="font-semibold text-sbkm-navy underline-offset-2 hover:underline dark:text-sbkm-mint" onClick={() => setSelectedId(null)}>
                Zur neuesten Prüfung
              </button>
            ) : null}
          </div>
          {shown.status === "failed" ? (
            <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">{shown.error ?? "Die Prüfung ist fehlgeschlagen."}</p>
          ) : (
            <DtSeoGroundingCheckDetail
              run={shown}
              canEdit={props.canEdit}
              viewerName={viewerName}
              onRun={onRun}
              onUploaded={props.onPagesChanged}
            />
          )}
        </div>
      ) : !latest ? (
        <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Noch keine Prüfung. „Website prüfen“ startet die erste.</p>
      ) : null}

      {runs.length > 0 ? (
        <details className="border-t border-sbkm-navy/10 pt-3 dark:border-white/10">
          <summary className={cn(LABEL_CLASS, "cursor-pointer")}>Verlauf ({runs.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs text-sbkm-navy dark:text-white">
              <thead className="text-sbkm-ink-600 dark:text-white/50">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Datum</th>
                  <th className="py-1 pr-3 font-semibold">Auslöser</th>
                  <th className="py-1 pr-3 font-semibold">Ergebnis</th>
                  <th className="py-1 pr-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className={cn(
                      "cursor-pointer border-t border-sbkm-navy/5 hover:bg-sbkm-mint/10 dark:border-white/5",
                      (selectedId ?? latest?.id) === run.id && "bg-sbkm-mint/15",
                    )}
                    onClick={() => setSelectedId(run.id === latest?.id ? null : run.id)}
                  >
                    <td className="py-1.5 pr-3">{formatDateTime(run.createdAt)}</td>
                    <td className="py-1.5 pr-3">{run.triggerLabel}</td>
                    <td className="py-1.5 pr-3">{run.decisionLabel ?? "—"}</td>
                    <td className="py-1.5 pr-3">{run.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </DtGlassCard>
  );
}
