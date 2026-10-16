/**
 * „Verbesserung“: a Seitenstruktur uploaded next to the crawl of the existing website. Pure,
 * so the matching rules are testable without Supabase; the store applies the plan.
 *
 * Unlike „Neue Website“ the upload does not create every row. Each Excel page is matched,
 * by normalised path first and by slug second, against
 *   1. the rows of the Texte table: the row gets the Excel briefing and keeps its text,
 *      steps, state, cost, live URL and crawled text;
 *   2. the crawled pages not taken over yet: nothing to do now, „Seiten übernehmen“ brings
 *      them in and the stored briefing is applied then;
 *   3. nothing: the page is not on the website yet. It is listed and created only on request
 *      („Diese Seiten anlegen“), without a live URL. Legal pages („Nicht bearbeiten“) are
 *      never listed.
 * Crawled pages that the Excel does not mention stay in the table as they are.
 */

import {
  contentPathKey,
  crawlPageSlug,
  isLiveCrawledPage,
  pageNameFromCrawl,
  pathOfUrl,
  type CrawledSitePage,
} from "@/lib/dt/content/crawl-pages";
import type { ContentBriefingPage } from "@/lib/dt/content/excel-structure";

/** What the plan needs of a row of `dt_content_pages`. */
export type StructurePlanRow = {
  slug: string;
  path?: string | null;
  source_url?: string | null;
  position?: number | null;
};

export type ImprovementStructurePlan = {
  /** Table rows that take the Excel briefing (row slug → Excel page). */
  updates: Array<{ slug: string; page: ContentBriefingPage }>;
  /** Excel pages found on the crawled site but not in the table yet. */
  onSite: ContentBriefingPage[];
  /**
   * Excel pages with a text to write that neither the table nor the crawled site has, ready
   * to insert: slug unique against the table, positioned after it, no live URL.
   */
  missing: ContentBriefingPage[];
  /** Whether there was a crawl to compare with (live crawled pages). */
  crawled: boolean;
};

type Candidate = { slug: string; keys: string[] };

function rowCandidate(row: StructurePlanRow): Candidate {
  const keys = [contentPathKey(row.path), contentPathKey(row.source_url)].filter((k): k is string => Boolean(k));
  return { slug: row.slug, keys: [...new Set(keys)] };
}

function crawlCandidate(page: CrawledSitePage): Candidate {
  const path = pathOfUrl(page.url);
  return { slug: crawlPageSlug(path, pageNameFromCrawl(page, path)), keys: [contentPathKey(path)!] };
}

/** The Excel page's path: the URL column, or the URL it was read from. */
export function excelPageKey(page: Pick<ContentBriefingPage, "path" | "source_url">): string | null {
  return contentPathKey(page.path) ?? contentPathKey(page.source_url);
}

/**
 * First by path, then by slug when the paths do not contradict each other (either side
 * without a path counts as „unknown“). Each candidate is used once.
 */
function findMatch(page: ContentBriefingPage, candidates: readonly Candidate[], taken: Set<number>): number {
  const key = excelPageKey(page);
  if (key) {
    const byPath = candidates.findIndex((c, i) => !taken.has(i) && c.keys.includes(key));
    if (byPath >= 0) return byPath;
  }
  return candidates.findIndex(
    (c, i) => !taken.has(i) && c.slug === page.slug && (!key || c.keys.length === 0 || c.keys.includes(key)),
  );
}

export function planImprovementStructure(
  excel: readonly ContentBriefingPage[],
  rows: readonly StructurePlanRow[],
  crawled: readonly CrawledSitePage[],
): ImprovementStructurePlan {
  const tableCandidates = rows.map(rowCandidate);
  const live = crawled.filter(isLiveCrawledPage);
  const siteCandidates = live.map(crawlCandidate);
  const tableTaken = new Set<number>();
  const siteTaken = new Set<number>();

  const updates: ImprovementStructurePlan["updates"] = [];
  const onSite: ContentBriefingPage[] = [];
  const unmatched: ContentBriefingPage[] = [];

  for (const page of excel) {
    const row = findMatch(page, tableCandidates, tableTaken);
    if (row >= 0) {
      tableTaken.add(row);
      updates.push({ slug: tableCandidates[row]!.slug, page });
      continue;
    }
    const site = findMatch(page, siteCandidates, siteTaken);
    if (site >= 0) {
      siteTaken.add(site);
      onSite.push(page);
      continue;
    }
    if (page.page_type !== "nicht_bearbeiten") unmatched.push(page);
  }

  // Ready to insert next to the existing rows: no slug of the table is overwritten.
  const used = new Set(rows.map((r) => r.slug));
  let position = rows.reduce((max, r) => Math.max(max, r.position ?? -1), -1) + 1;
  const missing = unmatched.map((page) => {
    let slug = page.slug;
    let n = 2;
    while (used.has(slug)) slug = `${page.slug}-${n++}`;
    used.add(slug);
    return { ...page, slug, position: position++, source_url: null };
  });

  return { updates, onSite, missing, crawled: live.length > 0 };
}

/**
 * The briefing columns an Excel page writes onto an existing row: everything the Excel
 * briefs, nothing that identifies the row or comes from a run (slug, name, path, source,
 * live URL, text, state, steps, cost). A structure without briefing columns (text, sitemap
 * …) only sets role, type, Hauptsilo and link targets; keywords and questions stay.
 */
export function briefingPatchFor(page: ContentBriefingPage, columns: "briefing" | "structure" = "briefing"): Record<string, unknown> {
  return {
    page_role: page.page_role,
    page_type: page.page_type,
    pillar_name: page.pillar_name,
    internal_link_targets: page.internal_link_targets,
    ...(columns === "briefing"
      ? {
          estimated_traffic: page.estimated_traffic,
          keywords: page.keywords,
          h1_options: page.h1_options,
          user_questions: page.user_questions,
          ki_prompt: page.ki_prompt,
          // A keyword the Analyse found stays when the Excel has none for the page.
          ...(page.keywords ? { main_keyword: page.keywords.main.text } : {}),
        }
      : {}),
  };
}
