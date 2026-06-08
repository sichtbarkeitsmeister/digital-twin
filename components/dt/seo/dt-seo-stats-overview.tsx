"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { DtGlassCard } from "@/components/dt/dt-glass-card";
import { cn } from "@/lib/utils";

type StatRow = {
  period_month: string;
  ai_clicks: number;
  total_clicks: number;
  impressions: number;
  rankings_top10: number;
  rankings_top3: number;
  visibility_index: number | null;
};

type Summary = {
  latest: StatRow | null;
  aiClicksMomPct: number | null;
  chart: Array<{
    periodMonth: string;
    label: string;
    aiClicks: number;
    totalClicks: number;
    rankingsTop10: number;
  }>;
  topKeywords: string[];
};

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <DtGlassCard className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-sbkm-ink-600 dark:text-white/50">
        {props.label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-sbkm-navy dark:text-white">
        {props.value}
      </p>
      {props.hint ? (
        <p className="mt-1 text-xs text-sbkm-ink-600 dark:text-white/55">{props.hint}</p>
      ) : null}
    </DtGlassCard>
  );
}

export function DtSeoStatsOverview(props: { organisationId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/dt/seo/stats?org=${encodeURIComponent(props.organisationId)}`);
    const json = (await res.json()) as {
      ok?: boolean;
      summary?: Summary;
      message?: string;
    };
    setLoading(false);
    if (!json.ok || !json.summary) {
      setError(json.message ?? "Statistiken konnten nicht geladen werden.");
      setSummary(null);
      return;
    }
    setSummary(json.summary);
  }, [props.organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="text-sm text-sbkm-ink-600 dark:text-white/60">Statistiken werden geladen …</p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {error}
      </p>
    );
  }

  const latest = summary?.latest;
  const maxAi = Math.max(1, ...(summary?.chart.map((c) => c.aiClicks) ?? [1]));
  const mom = summary?.aiClicksMomPct;

  if (!latest) {
    return (
      <DtGlassCard className="p-6">
        <p className="text-sm text-sbkm-ink-600 dark:text-white/65">
          Noch keine Monatsdaten. Der n8n-Workflow „DT v2 - Monthly Analytics“ schreibt nach dem
          Monatslauf KI-Klicks, GSC- und Sistrix-Werte hierher — der SEO-Berater nutzt dieselben
          Zahlen im Chat.
        </p>
      </DtGlassCard>
    );
  }

  const monthLabel = new Date(`${latest.period_month}T12:00:00`).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="KI-Klicks (aktueller Monat)"
          value={String(latest.ai_clicks)}
          hint={monthLabel}
        />
        <StatCard
          label="Veränderung KI-Klicks"
          value={mom == null ? "—" : `${mom >= 0 ? "+" : ""}${mom} %`}
          hint="gegenüber Vormonat"
        />
        <StatCard label="Gesamt-Klicks" value={String(latest.total_clicks)} />
        <StatCard label="Top-10-Rankings" value={String(latest.rankings_top10)} />
      </div>

      {mom != null ? (
        <p
          className={cn(
            "inline-flex items-center gap-2 text-sm font-semibold",
            mom >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-300",
          )}
        >
          {mom >= 0 ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )}
          KI-Traffic {mom >= 0 ? "gestiegen" : "gesunken"} um {Math.abs(mom)} % zum Vormonat.
        </p>
      ) : null}

      <DtGlassCard className="p-5">
        <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">
          KI-Klicks — letzte 12 Monate
        </h3>
        <div className="mt-4 flex h-40 items-end gap-1.5 sm:gap-2">
          {(summary?.chart ?? []).map((point) => (
            <div
              key={point.periodMonth}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              title={`${point.label}: ${point.aiClicks} KI-Klicks`}
            >
              <div
                className="w-full max-w-[28px] rounded-t-md bg-sbkm-mint transition-[height] dark:bg-sbkm-mint/90"
                style={{ height: `${Math.max(4, (point.aiClicks / maxAi) * 100)}%` }}
              />
              <span className="max-w-full truncate text-[10px] font-medium text-sbkm-ink-600 dark:text-white/50">
                {point.label}
              </span>
            </div>
          ))}
        </div>
      </DtGlassCard>

      {(summary?.topKeywords.length ?? 0) > 0 ? (
        <DtGlassCard className="p-5">
          <h3 className="text-sm font-bold text-sbkm-navy dark:text-white">Top-Keywords (letzter Monat)</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {summary!.topKeywords.map((kw) => (
              <li
                key={kw}
                className="rounded-pill border border-sbkm-navy/10 bg-white/60 px-3 py-1 text-xs font-semibold text-sbkm-navy dark:border-white/15 dark:bg-white/10 dark:text-white"
              >
                {kw}
              </li>
            ))}
          </ul>
        </DtGlassCard>
      ) : null}

      <p className="text-xs text-sbkm-ink-600 dark:text-white/50">
        Im SEO-Chat kann der Berater diese Werte abfragen (z. B. „Wie viele KI-Klicks im letzten
        Monat?“).
      </p>
    </div>
  );
}
