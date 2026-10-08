/**
 * Pages for the Texte table from the crawl of the existing website (`dt_site_pages`).
 * Pure, so the selection rules are testable without Supabase; `syncContentPagesFromCrawl`
 * in the store applies the plan. Mirrors `flattenStructure` for the Excel structure.
 */

import { slugify } from "@/lib/dt/content/render";
import { crawlHostKey, normaliseUrl } from "@/lib/dt/seo/crawl-url";

/** Same cap as the structure sync (`MAX_PAGES` in the store). */
export const CRAWL_PAGE_LIMIT = 300;

const NAME_MAX = 120;

export type CrawledSitePage = {
  url: string;
  title: string | null;
  h1: string | null;
  text_content: string | null;
  is_excluded: boolean;
  crawled_at: string;
  final_url?: string | null;
};

export type ExistingContentPage = {
  slug: string;
  path?: string | null;
  position?: number | null;
  source_url?: string | null;
};

export type PlannedCrawlPage = {
  slug: string;
  name: string;
  path: string;
  level: number;
  position: number;
  source_url: string;
  crawled_at: string;
};

export type CrawlPagePlan = {
  inserts: PlannedCrawlPage[];
  /** Rows that already exist under the same slug: they only get the live URL attached. */
  attach: Array<{ slug: string; source_url: string; crawled_at: string }>;
  skipped: { excluded: number; empty: number; redirected: number; duplicate: number; over_limit: number };
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `/leistungen/dach/` → `/leistungen/dach`; the root stays `/`. */
export function pathOfUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return pathname ? decodeSegment(pathname) : "/";
  } catch {
    return "/";
  }
}

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** `/Kontakt/`, `https://x.de/kontakt` and `/kontakt` are the same page; no path means „unknown“. */
export function sameContentPath(existing: string | null | undefined, crawled: string): boolean {
  const known = existing?.trim();
  if (!known) return true;
  const normalise = (value: string) => {
    const pathname = /^https?:\/\//i.test(value) ? pathOfUrl(value) : value;
    return (decodeSegment(pathname).replace(/\/+$/, "") || "/").toLowerCase();
  };
  return normalise(known) === normalise(crawled);
}

/** Host without `www.` plus path: the same page under http/https or www/non-www counts once. */
function pageKey(url: string): string | null {
  const normalised = normaliseUrl(url);
  if (!normalised) return null;
  try {
    const u = new URL(normalised);
    return `${crawlHostKey(u.hostname)}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
  } catch {
    return null;
  }
}

/** True when the crawl landed somewhere else, i.e. the URL only redirects. */
export function isRedirectedCrawlPage(page: Pick<CrawledSitePage, "url" | "final_url">): boolean {
  if (!page.final_url) return false;
  const from = pageKey(page.url);
  const to = pageKey(page.final_url);
  return Boolean(from && to && from !== to);
}

function squash(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** `Dachsanierung | Müller Bedachungen` → `Dachsanierung`; a lone brand stays as it is. */
export function cleanCrawledTitle(title: string | null | undefined): string {
  const text = squash(title);
  if (!text) return "";
  const first = text.split(/\s+[|–—·:]+\s+|\s+-\s+|\s+::\s+/)[0]?.trim() ?? "";
  return (first.length >= 3 ? first : text).slice(0, NAME_MAX);
}

function labelFromPath(path: string): string {
  const last = pathSegments(path).pop();
  if (!last) return "Startseite";
  return decodeSegment(last).replace(/\.(html?|php)$/i, "").replace(/[-_]+/g, " ").trim() || "Seite";
}

/** H1 first (what the page is about), then the title without the brand suffix, then the path. */
export function pageNameFromCrawl(page: Pick<CrawledSitePage, "h1" | "title">, path: string): string {
  const h1 = squash(page.h1).slice(0, NAME_MAX);
  if (h1) return h1;
  const title = cleanCrawledTitle(page.title);
  if (title) return title;
  return labelFromPath(path);
}

/** Fetch failures leave neither title nor text; those rows are not pages to write for. */
function hasContent(page: CrawledSitePage): boolean {
  return Boolean(squash(page.title) || squash(page.h1) || (page.text_content ?? "").trim());
}

/**
 * Which crawled pages become rows in the Texte table. Legal boilerplate (`is_excluded`),
 * redirects, empty fetches and www/http duplicates are left out. Ordered shallow to deep,
 * then by path, so the table reads like a menu. Slugs follow the structure flattener:
 * last path segment, `startseite` for the root, `-2` on collisions. An existing row with
 * the same slug is the same page only when its path agrees; then it is linked, not duplicated.
 */
export function planCrawlContentPages(
  existing: readonly ExistingContentPage[],
  crawled: readonly CrawledSitePage[],
  options: { limit?: number } = {},
): CrawlPagePlan {
  const limit = options.limit ?? CRAWL_PAGE_LIMIT;
  const skipped: CrawlPagePlan["skipped"] = { excluded: 0, empty: 0, redirected: 0, duplicate: 0, over_limit: 0 };
  const seen = new Set<string>();
  const candidates: Array<{ page: CrawledSitePage; path: string; level: number }> = [];

  for (const page of crawled) {
    if (page.is_excluded) {
      skipped.excluded += 1;
      continue;
    }
    if (isRedirectedCrawlPage(page)) {
      skipped.redirected += 1;
      continue;
    }
    if (!hasContent(page)) {
      skipped.empty += 1;
      continue;
    }
    const key = pageKey(page.url);
    if (!key || seen.has(key)) {
      skipped.duplicate += 1;
      continue;
    }
    seen.add(key);
    const path = pathOfUrl(page.url);
    candidates.push({ page, path, level: pathSegments(path).length });
  }

  candidates.sort((a, b) => a.level - b.level || a.path.localeCompare(b.path, "de"));

  const existingBySlug = new Map(existing.map((row) => [row.slug, row]));
  const used = new Set(existingBySlug.keys());
  let nextPosition = existing.reduce((max, row) => Math.max(max, row.position ?? -1), -1) + 1;
  let room = Math.max(0, limit - existing.length);
  const inserts: PlannedCrawlPage[] = [];
  const attach: CrawlPagePlan["attach"] = [];

  for (const { page, path, level } of candidates) {
    const name = pageNameFromCrawl(page, path);
    const lastSegment = pathSegments(path).pop() ?? "";
    const base = level === 0 ? "startseite" : slugify(decodeSegment(lastSegment)) || slugify(name) || "seite";

    const hit = existingBySlug.get(base);
    if (hit && sameContentPath(hit.path, path)) {
      if (!hit.source_url?.trim()) attach.push({ slug: base, source_url: page.url, crawled_at: page.crawled_at });
      continue;
    }
    if (room <= 0) {
      skipped.over_limit += 1;
      continue;
    }

    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    room -= 1;
    inserts.push({
      slug,
      name,
      path,
      level,
      position: nextPosition++,
      source_url: page.url,
      crawled_at: page.crawled_at,
    });
  }

  return { inserts, attach, skipped };
}
