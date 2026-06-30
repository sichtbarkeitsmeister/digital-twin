import { createServiceClient } from "@/lib/supabase/service";

export type DtSitePageSearchHit = {
  url: string;
  title: string | null;
  snippet: string;
  score: number;
};

const SNIPPET_RADIUS = 220;
const MAX_CANDIDATES = 40;

function sanitizeTerm(term: string): string {
  // PostgREST .or() is comma-delimited; strip characters that would break it
  // or that are useless for matching.
  return term.replace(/[%,()*]/g, " ").trim();
}

function extractTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.split(/\s+/)) {
    const t = sanitizeTerm(raw).toLowerCase();
    if (t.length >= 3 && !seen.has(t)) {
      seen.add(t);
      terms.push(t);
    }
    if (terms.length >= 6) break;
  }
  // Fall back to the whole (sanitized) query if no usable tokens.
  if (terms.length === 0) {
    const whole = sanitizeTerm(query).toLowerCase();
    if (whole) terms.push(whole);
  }
  return terms;
}

function buildSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) {
    return text.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS);
  const prefix = start > 0 ? "… " : "";
  const suffix = end < text.length ? " …" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function scoreRow(
  row: { title: string | null; h1: string | null; meta_description: string | null; text_content: string | null },
  terms: string[],
): number {
  const haystacks: Array<[string, number]> = [
    [row.title ?? "", 5],
    [row.h1 ?? "", 4],
    [row.meta_description ?? "", 3],
    [row.text_content ?? "", 1],
  ];
  let score = 0;
  for (const [hay, weight] of haystacks) {
    const lower = hay.toLowerCase();
    for (const t of terms) {
      let idx = lower.indexOf(t);
      while (idx !== -1) {
        score += weight;
        idx = lower.indexOf(t, idx + t.length);
      }
    }
  }
  return score;
}

/**
 * Keyword search across all crawled pages of an organisation. Returns the most
 * relevant pages with a short snippet around the first match — token-light, so
 * the agent can pull just what it needs instead of receiving every page body.
 */
export async function searchDtSitePages(
  organisationId: string,
  query: string,
  limit = 5,
): Promise<DtSitePageSearchHit[]> {
  const terms = extractTerms(query);
  if (terms.length === 0) return [];

  const supabase = createServiceClient();

  const orFilter = terms
    .flatMap((t) => [
      `title.ilike.%${t}%`,
      `h1.ilike.%${t}%`,
      `meta_description.ilike.%${t}%`,
      `text_content.ilike.%${t}%`,
    ])
    .join(",");

  const { data } = await supabase
    .from("dt_site_pages")
    .select("url,title,h1,meta_description,text_content")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .or(orFilter)
    .limit(MAX_CANDIDATES);

  const rows = (data ?? []) as Array<{
    url: string;
    title: string | null;
    h1: string | null;
    meta_description: string | null;
    text_content: string | null;
  }>;

  return rows
    .map((r) => ({
      url: r.url,
      title: r.title,
      score: scoreRow(r, terms),
      snippet: buildSnippet(r.text_content ?? r.meta_description ?? r.title ?? "", terms),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

/** Full text of a single crawled page (matched by exact or suffix URL). */
export async function getDtSitePageContent(
  organisationId: string,
  url: string,
  maxChars = 16_000,
): Promise<{ url: string; title: string | null; content: string } | null> {
  const supabase = createServiceClient();
  const trimmed = url.trim();

  let { data } = await supabase
    .from("dt_site_pages")
    .select("url,title,text_content")
    .eq("organisation_id", organisationId)
    .eq("url", trimmed)
    .maybeSingle();

  if (!data) {
    // Tolerate trailing-slash / scheme differences by matching on the path tail.
    let pathTail = trimmed;
    try {
      pathTail = new URL(trimmed).pathname;
    } catch {
      /* keep as-is */
    }
    const res = await supabase
      .from("dt_site_pages")
      .select("url,title,text_content")
      .eq("organisation_id", organisationId)
      .ilike("url", `%${pathTail.replace(/[%,]/g, " ")}%`)
      .limit(1)
      .maybeSingle();
    data = res.data;
  }

  if (!data) return null;

  const content = (data.text_content ?? "").slice(0, maxChars);
  return { url: data.url, title: data.title, content };
}
