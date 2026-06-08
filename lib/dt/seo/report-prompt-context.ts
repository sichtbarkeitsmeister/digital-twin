import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseSeoReportPayload,
  timeframeLabel,
} from "@/lib/dt/seo/report-payload";
import type { ParsedReportRecommendation } from "@/lib/dt/seo/report-recommendations";
import type { DtSeoReportRow } from "@/lib/dt/types";

export type DtSeoReportPromptRow = Pick<
  DtSeoReportRow,
  "id" | "url" | "focus_keyword" | "timeframe" | "state" | "finished_at" | "created_at" | "payload"
>;

export async function loadLatestDtSeoReportForPrompt(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtSeoReportPromptRow | null> {
  const { data, error } = await supabase
    .from("dt_seo_reports")
    .select("id,url,focus_keyword,timeframe,state,finished_at,created_at,payload")
    .eq("organisation_id", organisationId)
    .eq("state", "done")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[dt] loadLatestDtSeoReportForPrompt:", error.message);
    return null;
  }

  return (data as DtSeoReportPromptRow | null) ?? null;
}

function formatReportDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatKeywordLine(item: {
  keyword: string;
  position: string | null;
  impressions: string | null;
  clicks: string | null;
  trend: string | null;
}): string {
  const parts = [item.keyword];
  if (item.position) parts.push(`Pos. ${item.position}`);
  if (item.impressions) parts.push(`${item.impressions} Impr.`);
  if (item.clicks) parts.push(`${item.clicks} Klicks`);
  if (item.trend) parts.push(`Trend: ${item.trend}`);
  return `- ${parts.join(" | ")}`;
}

function formatRecommendationLine(rec: ParsedReportRecommendation, index: number): string {
  const parts = [`${index + 1}. ${rec.title}`];
  if (rec.keyword) parts.push(`Keyword: ${rec.keyword}`);
  if (rec.currentStatus) parts.push(`Ist: ${rec.currentStatus}`);
  if (rec.url) parts.push(`URL: ${rec.url}`);
  parts.push(`Maßnahme: ${rec.action}`);
  return `- ${parts.join(" | ")}`;
}

export function formatDtSeoReportForPrompt(report: DtSeoReportPromptRow | null): string {
  if (!report) {
    return [
      "Kein abgeschlossener SEO-Report vorhanden.",
      "Wenn der Nutzer nach Report-Daten fragt: unter „Reports“ einen neuen SEO-Report starten.",
    ].join("\n");
  }

  const parsed = parseSeoReportPayload(report.payload);
  const hasContent =
    parsed.hasRaw ||
    parsed.summaryText ||
    parsed.recommendations.length > 0 ||
    parsed.keywordWatchlist.length > 0 ||
    parsed.kpis.length > 0;

  if (!hasContent) {
    return [
      `Letzter Report (${formatReportDate(report.finished_at ?? report.created_at)}) ist als fertig markiert, enthält aber noch keine auswertbaren Daten.`,
      "Bitte den Nutzer, den Report erneut zu starten oder Support zu kontaktieren.",
    ].join("\n");
  }

  const lines: string[] = [
    `Report-ID: ${report.id}`,
    `Erstellt: ${formatReportDate(report.finished_at ?? report.created_at)}`,
    report.url ? `Analysierte Website: ${report.url}` : "",
    report.focus_keyword ? `Fokus-Keyword: ${report.focus_keyword}` : "",
    report.timeframe ? `Zeitraum: ${timeframeLabel(report.timeframe)}` : "",
  ].filter(Boolean);

  if (parsed.summaryText) {
    lines.push("", "Zusammenfassung:", parsed.summaryText);
  }

  if (parsed.kpis.length > 0) {
    lines.push("", "Kern-KPIs:");
    for (const kpi of parsed.kpis) {
      lines.push(`- ${kpi.label}: ${kpi.value}${kpi.hint ? ` (${kpi.hint})` : ""}`);
    }
  }

  if (parsed.keywordWatchlist.length > 0) {
    const shown = parsed.keywordWatchlist.slice(0, 25);
    lines.push(
      "",
      `Top-Keywords (${shown.length}${parsed.keywordWatchlist.length > shown.length ? ` von ${parsed.keywordWatchlist.length}` : ""}):`,
    );
    for (const kw of shown) {
      lines.push(formatKeywordLine(kw));
    }
  }

  if (parsed.recommendations.length > 0) {
    const shown = parsed.recommendations.slice(0, 12);
    lines.push("", `Handlungsempfehlungen (${shown.length}):`);
    for (const [index, rec] of shown.entries()) {
      lines.push(formatRecommendationLine(rec, index));
    }
    if (parsed.recommendations.length > shown.length) {
      lines.push(`… ${parsed.recommendations.length - shown.length} weitere Empfehlungen im vollständigen Report.`);
    }
  }

  lines.push(
    "",
    "Dies ist der aktuellste abgeschlossene SEO-Report. Nutze diese Daten für Rankings, Keywords und Maßnahmen — erfinde keine Zahlen außerhalb dieses Reports und der monatlichen Trends.",
  );

  return lines.join("\n");
}
