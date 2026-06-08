import type { SupabaseClient } from "@supabase/supabase-js";

export type DtSeoMonthlyStatsRow = {
  id: string;
  organisation_id: string;
  period_month: string;
  ai_clicks: number;
  total_clicks: number;
  impressions: number;
  rankings_top10: number;
  rankings_top3: number;
  visibility_index: number | null;
  raw_data: Record<string, unknown>;
  created_at: string;
};

export async function loadDtSeoMonthlyStats(
  supabase: SupabaseClient,
  organisationId: string,
  limit = 12,
): Promise<DtSeoMonthlyStatsRow[]> {
  const { data, error } = await supabase
    .from("dt_seo_monthly_stats")
    .select(
      "id,organisation_id,period_month,ai_clicks,total_clicks,impressions,rankings_top10,rankings_top3,visibility_index,raw_data,created_at",
    )
    .eq("organisation_id", organisationId)
    .order("period_month", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[dt] loadDtSeoMonthlyStats:", error.message);
    return [];
  }

  return (data ?? []) as DtSeoMonthlyStatsRow[];
}

function formatMonthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T12:00:00`);
  if (Number.isNaN(d.getTime())) return periodMonth;
  return d.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
}

export function formatDtSeoMonthlyStatsForPrompt(rows: DtSeoMonthlyStatsRow[]): string {
  if (rows.length === 0) {
    return "Keine monatlichen SEO-Statistiken hinterlegt. Bei Fragen zu Klicks/Rankings weise darauf hin, dass der Monatslauf noch keine Daten geliefert hat.";
  }

  const chronological = [...rows].sort(
    (a, b) => new Date(a.period_month).getTime() - new Date(b.period_month).getTime(),
  );

  const lines = chronological.map((r) => {
    const vis =
      r.visibility_index != null ? `, Sistrix-Sichtbarkeit ${Number(r.visibility_index).toFixed(1)}` : "";
    return `- ${formatMonthLabel(r.period_month)}: KI-Klicks ${r.ai_clicks}, Gesamt-Klicks ${r.total_clicks}, Impressionen ${r.impressions}, Top-10-Rankings ${r.rankings_top10}, Top-3 ${r.rankings_top3}${vis}`;
  });

  const latest = chronological[chronological.length - 1]!;
  const prev = chronological[chronological.length - 2];
  let delta = "";
  if (prev && prev.ai_clicks > 0) {
    const pct = Math.round(((latest.ai_clicks - prev.ai_clicks) / prev.ai_clicks) * 100);
    delta = ` MoM KI-Klicks: ${pct >= 0 ? "+" : ""}${pct}%.`;
  }

  return [
    "Monatliche Messwerte (neueste zuletzt):",
    ...lines,
    `Letzter Monat (${formatMonthLabel(latest.period_month)}): ${latest.ai_clicks} KI-Klicks.${delta}`,
    "Beantworte Fragen zu Traffic und Rankings anhand dieser Zahlen; erfinde keine Werte.",
  ].join("\n");
}

export function computeSeoStatsSummary(rows: DtSeoMonthlyStatsRow[]) {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.period_month).getTime() - new Date(a.period_month).getTime(),
  );
  const latest = sorted[0] ?? null;
  const previous = sorted[1] ?? null;

  const aiClicksMomPct =
    latest && previous && previous.ai_clicks > 0
      ? Math.round(((latest.ai_clicks - previous.ai_clicks) / previous.ai_clicks) * 100)
      : null;

  const chart = [...sorted]
    .reverse()
    .slice(-12)
    .map((r) => ({
      periodMonth: r.period_month,
      label: formatMonthLabel(r.period_month),
      aiClicks: r.ai_clicks,
      totalClicks: r.total_clicks,
      rankingsTop10: r.rankings_top10,
    }));

  const topKeywords = extractTopKeywords(latest?.raw_data);

  return { latest, previous, aiClicksMomPct, chart, topKeywords };
}

function extractTopKeywords(raw: Record<string, unknown> | undefined): string[] {
  if (!raw) return [];
  const kw = raw.top_keywords ?? raw.topKeywords;
  if (!Array.isArray(kw)) return [];
  return kw
    .map((k) => (typeof k === "string" ? k.trim() : String(k)))
    .filter(Boolean)
    .slice(0, 10);
}
