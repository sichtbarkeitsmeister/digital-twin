"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, XCircle } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { DtPillButton } from "@/components/dt/dt-pill-button";
import type { SeoAuditFinding, StructuredDataSample } from "@/lib/dt/seo/crawl-onpage-audit";
import { cn } from "@/lib/utils";

type AuditResponse = {
  ok?: boolean;
  message?: string;
  pageCount?: number;
  lastCrawl?: { status: string; message: string | null; finishedAt: string | null } | null;
  lastReport?: {
    id: string;
    state: string;
    message: string | null;
    createdAt: string;
  } | null;
  structuredSamples?: StructuredDataSample[];
  findings?: SeoAuditFinding[];
  summary?: { errorCount: number; warningCount: number; ok: boolean };
};

const CATEGORY_LABEL: Record<SeoAuditFinding["category"], string> = {
  onpage: "On-Page",
  content: "Inhalt",
  structured_data: "Structured Data",
  crawl: "Crawl",
  report: "Report",
};

export function DtSeoAuditPanel(props: { organisationId: string }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withStructured, setWithStructured] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        org: props.organisationId,
        structured: withStructured ? "1" : "0",
      });
      const res = await fetch(`/api/dt/seo/crawl-audit?${params}`);
      const json = (await res.json()) as AuditResponse;
      if (!json.ok) {
        setError(json.message ?? "Analyse fehlgeschlagen.");
        setData(null);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyse fehlgeschlagen.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [props.organisationId, withStructured]);

  useEffect(() => {
    void load();
  }, [load]);

  const findings = data?.findings ?? [];
  const summary = data?.summary;
  const settingsHref = `/dashboard/verwaltung/seo?org=${encodeURIComponent(props.organisationId)}&tab=settings`;
  const crawlHref = `/dashboard/verwaltung/seo/crawl?org=${encodeURIComponent(props.organisationId)}`;

  return (
    <div className="grid gap-4">
      <DtGlassCard className="grid gap-3 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 grid gap-1">
            <h2 className="text-lg font-bold text-sbkm-navy dark:text-white">
              SEO-Analyse (Crawl + Stichprobe)
            </h2>
            <p className="text-sm text-sbkm-ink-600 dark:text-white/60">
              Tiefe technische Checks aus dem Website-Crawl (Title, H1, Meta, Inhalt) und optional
              Live-Stichprobe auf Structured Data (JSON-LD). Setup-Felder bleiben unter
              Einstellungen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-sbkm-ink-600 dark:text-white/65">
              <input
                type="checkbox"
                checked={withStructured}
                onChange={(e) => setWithStructured(e.target.checked)}
              />
              Structured Data live prüfen
            </label>
            <DtPillButton type="button" size="sm" disabled={busy} onClick={() => void load()}>
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Analysiert…
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" aria-hidden />
                  Neu analysieren
                </>
              )}
            </DtPillButton>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        {data ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-sbkm-navy/10 bg-white/50 px-2.5 py-1 dark:border-white/10 dark:bg-white/5">
              {data.pageCount ?? 0} Crawl-Seiten
            </span>
            {data.lastCrawl ? (
              <span className="rounded-full border border-sbkm-navy/10 bg-white/50 px-2.5 py-1 dark:border-white/10 dark:bg-white/5">
                Letzter Crawl: {data.lastCrawl.status}
              </span>
            ) : null}
            {data.lastReport ? (
              <span className="rounded-full border border-sbkm-navy/10 bg-white/50 px-2.5 py-1 dark:border-white/10 dark:bg-white/5">
                Letzter Report: {data.lastReport.state}
              </span>
            ) : null}
            {summary ? (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 font-semibold",
                  summary.ok
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                    : "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200",
                )}
              >
                {summary.errorCount} Fehler · {summary.warningCount} Hinweise
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={settingsHref} className="font-semibold text-sbkm-mint hover:underline">
            Zu Einstellungen / Crawl starten
          </Link>
          <span className="text-sbkm-ink-400">·</span>
          <Link href={crawlHref} className="font-semibold text-sbkm-mint hover:underline">
            Crawl-Inhalte ansehen
          </Link>
        </div>
      </DtGlassCard>

      {busy && !data ? (
        <p className="flex items-center gap-2 text-sm text-sbkm-ink-600">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Analyse läuft…
        </p>
      ) : null}

      {findings.length === 0 && data && !busy ? (
        <DtGlassCard className="p-5 text-sm text-sbkm-ink-600 dark:text-white/65">
          Keine On-Page-/Structured-Data-Probleme in der aktuellen Analyse gefunden.
        </DtGlassCard>
      ) : null}

      <div className="grid gap-3">
        {findings.map((f) => {
          const isError = f.severity === "error";
          return (
            <DtGlassCard
              key={f.code}
              className={cn(
                "grid gap-2 border p-4",
                isError ? "border-red-500/25" : "border-amber-500/25",
              )}
            >
              <div className="flex flex-wrap items-start gap-2">
                {isError ? (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-300" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-200" />
                )}
                <div className="min-w-0 flex-1 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-sbkm-ink-500">
                      {CATEGORY_LABEL[f.category]}
                    </span>
                    {f.count > 0 ? (
                      <span className="text-[10px] font-semibold text-sbkm-ink-500">
                        {f.count}×
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-sbkm-navy dark:text-white">{f.title}</p>
                  <p className="text-xs text-sbkm-ink-600 dark:text-white/65">{f.message}</p>
                  {f.sampleUrls.length > 0 ? (
                    <ul className="mt-1 grid gap-0.5">
                      {f.sampleUrls.map((u) => (
                        <li key={u} className="truncate font-mono text-[11px] text-sbkm-ink-500">
                          <a
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-sbkm-mint hover:underline"
                          >
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </DtGlassCard>
          );
        })}
      </div>

      {data?.structuredSamples && data.structuredSamples.length > 0 ? (
        <DtGlassCard className="grid gap-2 p-4">
          <p className="text-sm font-semibold text-sbkm-navy dark:text-white">
            Structured-Data-Stichprobe
          </p>
          <ul className="grid gap-1.5 text-xs">
            {data.structuredSamples.map((s) => (
              <li key={s.url} className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-bold uppercase",
                    s.ok && s.hasJsonLd
                      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                      : "bg-amber-500/15 text-amber-900 dark:text-amber-100",
                  )}
                >
                  {s.ok ? (s.hasJsonLd ? "JSON-LD" : "ohne") : "Fehler"}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{s.url}</span>
                {s.types.length ? (
                  <span className="text-sbkm-ink-500">{s.types.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </DtGlassCard>
      ) : null}
    </div>
  );
}
