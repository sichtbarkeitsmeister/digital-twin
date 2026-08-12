import {
  parseActionableRecommendations,
  parseKeywordWatchlist,
  type ParsedReportRecommendation,
  type SeoKeywordWatchlistItem,
} from "@/lib/dt/seo/report-recommendations";

export type SeoReportRecommendation = ParsedReportRecommendation;

export type SeoReportKpi = {
  label: string;
  value: string;
  hint?: string;
};

export type ParsedSeoReportPayload = {
  reportHtml: string | null;
  /** Actionable items with a Maßnahme — can become Aufgaben. */
  recommendations: SeoReportRecommendation[];
  /** GSC keyword rankings for monitoring (not auto-tasks). */
  keywordWatchlist: SeoKeywordWatchlistItem[];
  summaryText: string | null;
  kpis: SeoReportKpi[];
  keywordHighlights: string[];
  hasRaw: boolean;
  generatedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : null;
  }
  return null;
}

function extractKeywordAnalysisList(payload: Record<string, unknown>): unknown[] {
  const kw = asRecord(payload.keyword_analysis);
  const top =
    (Array.isArray(kw?.top_keywords_with_trend) ? kw?.top_keywords_with_trend : null) ??
    (Array.isArray(kw?.top_keywords) ? kw?.top_keywords : null) ??
    [];
  return top;
}

function legacyKeywordOnlyTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const titles: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = asString(row.title);
    const action = asString(row.action);
    if (title && !action) titles.push(title);
  }
  return titles;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}

function formatPercent(n: number): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n)} %`;
}

function extractKpis(payload: Record<string, unknown>): SeoReportKpi[] {
  const sources = [payload, asRecord(payload.raw) ?? {}];
  const kpis: SeoReportKpi[] = [];

  for (const source of sources) {
    const summary = asRecord(source.summary);
    const total = asRecord(summary?.total_metrics);
    const ga4 = asRecord(total?.ga4);
    const gsc = asRecord(total?.gsc);

    const sessions = typeof ga4?.sessions === "number" ? ga4.sessions : null;
    const users = typeof ga4?.users === "number" ? ga4.users : null;
    const clicks = typeof gsc?.clicks === "number" ? gsc.clicks : null;
    const impressions = typeof gsc?.impressions === "number" ? gsc.impressions : null;
    const ctr = typeof gsc?.ctr === "number" ? gsc.ctr : null;
    const conversions =
      typeof ga4?.total_conversions === "number" ? ga4.total_conversions : null;

    if (sessions != null && !kpis.some((k) => k.label === "Sitzungen")) {
      kpis.push({ label: "Sitzungen", value: formatNumber(sessions) });
    }
    if (users != null && !kpis.some((k) => k.label === "Nutzer")) {
      kpis.push({ label: "Nutzer", value: formatNumber(users) });
    }
    if (clicks != null && !kpis.some((k) => k.label === "Klicks (GSC)")) {
      kpis.push({ label: "Klicks (GSC)", value: formatNumber(clicks) });
    }
    if (impressions != null && !kpis.some((k) => k.label === "Impressionen")) {
      kpis.push({ label: "Impressionen", value: formatNumber(impressions) });
    }
    if (ctr != null && !kpis.some((k) => k.label === "CTR")) {
      kpis.push({ label: "CTR", value: formatPercent(ctr * (ctr <= 1 ? 100 : 1)) });
    }
    if (conversions != null && !kpis.some((k) => k.label === "Conversions")) {
      kpis.push({ label: "Conversions", value: formatNumber(conversions) });
    }

    if (kpis.length >= 4) break;
  }

  return kpis.slice(0, 4);
}

function extractKeywordHighlights(watchlist: SeoKeywordWatchlistItem[]): string[] {
  return watchlist.slice(0, 5).map((item) => item.keyword);
}

export function parseSeoReportPayload(raw: unknown): ParsedSeoReportPayload {
  const payload = asRecord(raw) ?? {};
  const reportHtml = asString(payload.reportHtml) ?? asString(payload.report_html);
  const summary = payload.summary;
  let summaryText: string | null = null;
  if (typeof summary === "string") summaryText = asString(summary);
  else if (summary && typeof summary === "object") {
    const s = asRecord(summary);
    summaryText = asString(s?.headline) ?? asString(s?.text) ?? null;
  }

  const keywordWatchlist = parseKeywordWatchlist(
    extractKeywordAnalysisList(payload),
    legacyKeywordOnlyTitles(payload.recommendations),
  );

  return {
    reportHtml,
    recommendations: parseActionableRecommendations(payload.recommendations),
    keywordWatchlist,
    summaryText,
    kpis: extractKpis(payload),
    keywordHighlights: extractKeywordHighlights(keywordWatchlist),
    hasRaw: payload.raw != null,
    generatedAt: asString(payload.generatedAt) ?? asString(payload.generated_at),
  };
}

export function timeframeLabel(timeframe: string | null | undefined): string {
  switch (timeframe) {
    case "last_7_days":
      return "Letzte 7 Tage";
    case "last_30_days":
      return "Letzte 30 Tage";
    case "last_90_days":
      return "Letzte 90 Tage (3 Monate)";
    default:
      return timeframe?.trim() || "—";
  }
}

export function recipientTypeLabel(type: string): string {
  return type === "intern" ? "Intern" : type === "kunde" ? "Kunde" : type;
}

export function reportStateLabel(state: string): string {
  switch (state) {
    case "queued":
      return "Warteschlange";
    case "running":
      return "Läuft …";
    case "done":
      return "Fertig";
    case "error":
      return "Fehler";
    case "cancelled":
      return "Abgebrochen";
    default:
      return state;
  }
}

export type OwnerDeliveryStatus = {
  label: string;
  title?: string;
  tone: "sent" | "pending" | "scheduled";
};

export function resolveOwnerDeliveryStatus(report: {
  send_to_owner?: boolean;
  owner_sent_at?: string | null;
  state: string;
}): OwnerDeliveryStatus | null {
  if (report.owner_sent_at) {
    const when = new Date(report.owner_sent_at).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      label: "Per E-Mail gesendet",
      title: `E-Mail an die Report-E-Mail gesendet am ${when}`,
      tone: "sent",
    };
  }
  if (!report.send_to_owner) return null;
  if (report.state === "queued" || report.state === "running") {
    return {
      label: "E-Mail geplant",
      title: "Nach Fertigstellung wird die Report-E-Mail aus den SEO-Einstellungen benachrichtigt.",
      tone: "scheduled",
    };
  }
  if (report.state === "done") {
    return {
      label: "E-Mail-Versand ausstehend",
      title: "Der Report ist fertig, die E-Mail an die Report-E-Mail wurde noch nicht versendet.",
      tone: "pending",
    };
  }
  return null;
}
