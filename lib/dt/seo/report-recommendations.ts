export type ParsedReportRecommendation = {
  title: string;
  action: string;
  keyword: string | null;
  currentStatus: string | null;
  url: string | null;
};

export type SeoKeywordWatchlistItem = {
  keyword: string;
  position: string | null;
  impressions: string | null;
  clicks: string | null;
  trend: string | null;
};

const TITLE_POSITION_RE = /^(.+?)\s*\(Pos\.\s*([^)]+)\)\s*$/i;

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function formatCount(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("de-DE").format(Math.round(value));
  }
  return null;
}

function parseTitlePosition(title: string): { keyword: string; position: string } | null {
  const match = title.match(TITLE_POSITION_RE);
  if (!match) return null;
  return { keyword: match[1].trim(), position: match[2].trim() };
}

function buildCurrentStatus(parts: {
  position: string | null;
  impressions: string | null;
  clicks: string | null;
}): string | null {
  const statusParts: string[] = [];
  if (parts.position) statusParts.push(`Pos. ${parts.position}`);
  if (parts.impressions) statusParts.push(`${parts.impressions} Impr.`);
  if (parts.clicks) statusParts.push(`${parts.clicks} Klicks`);
  return statusParts.length ? statusParts.join(", ") : null;
}

/** Actionable recommendation — only returned when a Maßnahme (`action`) is present. */
export function parseActionableRecommendation(item: unknown): ParsedReportRecommendation | null {
  if (!item || typeof item !== "object") return null;

  const row = item as Record<string, unknown>;
  const action = asTrimmedString(row.action);
  if (!action) return null;

  const keyword = asTrimmedString(row.keyword);
  const position = row.position != null ? String(row.position).trim() : null;
  const titleFromRow = asTrimmedString(row.title);
  const parsedTitle = titleFromRow ? parseTitlePosition(titleFromRow) : null;

  const keywordResolved = keyword ?? parsedTitle?.keyword ?? null;
  const positionResolved = position ?? parsedTitle?.position ?? null;
  const currentStatus = buildCurrentStatus({
    position: positionResolved,
    impressions: formatCount(row.impressions),
    clicks: formatCount(row.clicks),
  });

  const title =
    titleFromRow ??
    (keywordResolved ? `Maßnahme: ${keywordResolved}` : action.slice(0, 500));

  return {
    title,
    action,
    keyword: keywordResolved,
    currentStatus,
    url: asTrimmedString(row.url),
  };
}

export function parseKeywordWatchlistItem(item: unknown): SeoKeywordWatchlistItem | null {
  if (typeof item === "string") {
    const keyword = item.trim();
    return keyword ? { keyword, position: null, impressions: null, clicks: null, trend: null } : null;
  }

  if (!item || typeof item !== "object") return null;

  const row = item as Record<string, unknown>;
  const keyword = asTrimmedString(row.keyword);
  if (!keyword) return null;

  return {
    keyword,
    position: row.position != null ? String(row.position).trim() : null,
    impressions: formatCount(row.impressions),
    clicks: formatCount(row.clicks),
    trend: asTrimmedString(row.trend),
  };
}

/** Legacy keyword-only recommendation titles, e.g. "umzug köln (Pos. 15.7)". */
export function parseLegacyKeywordWatchlistTitle(title: string): SeoKeywordWatchlistItem | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const parsed = parseTitlePosition(trimmed);
  if (parsed) {
    return {
      keyword: parsed.keyword,
      position: parsed.position,
      impressions: null,
      clicks: null,
      trend: null,
    };
  }

  return { keyword: trimmed, position: null, impressions: null, clicks: null, trend: null };
}

export function parseActionableRecommendations(raw: unknown): ParsedReportRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedReportRecommendation[] = [];
  for (const item of raw) {
    const parsed = parseActionableRecommendation(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseKeywordWatchlist(rawKeywords: unknown, legacyTitles: string[] = []): SeoKeywordWatchlistItem[] {
  const out: SeoKeywordWatchlistItem[] = [];
  const seen = new Set<string>();

  const push = (item: SeoKeywordWatchlistItem | null) => {
    if (!item) return;
    const key = item.keyword.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  if (Array.isArray(rawKeywords)) {
    for (const item of rawKeywords) {
      push(parseKeywordWatchlistItem(item));
    }
  }

  for (const title of legacyTitles) {
    push(parseLegacyKeywordWatchlistTitle(title));
  }

  return out;
}
