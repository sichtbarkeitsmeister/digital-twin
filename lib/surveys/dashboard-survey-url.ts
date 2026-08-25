const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DASHBOARD_SURVEY_PATH_RE =
  /\/dashboard\/surveys\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$|\?|#)/gi;

function uuidOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Extract a survey UUID from a dashboard builder/list URL (absolute or path). */
export function extractDashboardSurveyIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "https://digital-twin-sbkm.de");
    const match = parsed.pathname.match(
      /^\/dashboard\/surveys\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
    );
    return uuidOrNull(match?.[1] ?? null);
  } catch {
    return null;
  }
}

export function isDashboardSurveyAppUrl(url: string): boolean {
  return extractDashboardSurveyIdFromUrl(url) !== null;
}

/** Collect unique survey UUIDs from dashboard links in free text. */
export function extractDashboardSurveyIdsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(DASHBOARD_SURVEY_PATH_RE.source, "gi");
  for (const match of text.matchAll(re)) {
    const id = uuidOrNull(match[1] ?? null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
