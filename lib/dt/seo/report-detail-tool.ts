import { createServiceClient } from "@/lib/supabase/service";

/** Max chars returned by read_full_seo_report — bounds tool-result token cost. */
export const SEO_REPORT_RAW_MAX_CHARS = 12_000;

export type DtSeoReportRawRow = {
  id: string;
  url: string | null;
  focus_keyword: string | null;
  timeframe: string | null;
  finished_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Remove HTML blobs from raw analytics — structured data only for the tool. */
function stripHtmlFromRaw(raw: unknown): unknown {
  const record = asRecord(raw);
  if (!record) return raw;

  const cleaned: Record<string, unknown> = { ...record };
  delete cleaned.report_html;
  delete cleaned.reportHtml;

  return cleaned;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Loads the latest completed SEO report for an organisation (service role).
 * Returns the full payload row so callers can extract payload.raw.
 */
export async function loadLatestDtSeoReportRawForOrg(
  organisationId: string,
): Promise<DtSeoReportRawRow | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("dt_seo_reports")
    .select("id,url,focus_keyword,timeframe,finished_at,created_at,payload")
    .eq("organisation_id", organisationId)
    .eq("state", "done")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[dt] loadLatestDtSeoReportRawForOrg:", error.message);
    return null;
  }

  return (data as DtSeoReportRawRow | null) ?? null;
}

/**
 * Formats payload.raw as compact JSON for the read_full_seo_report tool.
 * Strips embedded HTML and caps output length for token efficiency.
 */
export function formatSeoReportRawForTool(
  report: DtSeoReportRawRow | null,
  maxChars = SEO_REPORT_RAW_MAX_CHARS,
): string {
  if (!report) {
    return [
      "Kein abgeschlossener SEO-Report vorhanden.",
      "Der Nutzer kann unter „Reports“ einen neuen SEO-Report starten.",
    ].join("\n");
  }

  const payload = asRecord(report.payload) ?? {};
  const raw = payload.raw;

  if (raw == null) {
    return [
      `Report ${report.id} ist als fertig markiert, enthält aber keine Rohdaten (payload.raw).`,
      "Bitte den Nutzer bitten, den Report erneut zu starten oder Support zu kontaktieren.",
    ].join("\n");
  }

  const cleaned = stripHtmlFromRaw(raw);
  const header = [
    `Report-ID: ${report.id}`,
    report.url ? `Website: ${report.url}` : "",
    report.focus_keyword ? `Fokus-Keyword: ${report.focus_keyword}` : "",
    report.timeframe ? `Zeitraum: ${report.timeframe}` : "",
    `Erstellt: ${report.finished_at ?? report.created_at}`,
    "",
    "Vollständige Rohdaten (payload.raw, vor n8n-Komprimierung):",
  ]
    .filter(Boolean)
    .join("\n");

  const json = compactJson(cleaned);
  const budget = Math.max(500, maxChars - header.length - 80);

  if (json.length <= budget) {
    return `${header}\n${json}`;
  }

  const truncated = json.slice(0, budget);
  return [
    header,
    truncated,
    "",
    `… Ausgabe gekürzt (${json.length.toLocaleString("de-DE")} Zeichen gesamt, Limit ${maxChars.toLocaleString("de-DE")}).`,
    "Frage gezielt nach einem Abschnitt (z. B. keyword_analysis, recommendations, summary), wenn du nur einen Teil brauchst.",
  ].join("\n");
}
