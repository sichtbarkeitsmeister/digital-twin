/**
 * The second input of the text tools SEO, GEO and Hormozi: a page of the organisation's
 * crawled website instead of an uploaded file. Same crawl as Texte („Website crawlen“ in
 * Seitenquelle, `dt_site_pages`), same page list rules (`planCrawlContentPages`: no
 * AGB/Widerruf, no redirects, no empty fetches, no www/http duplicates, shallow to deep),
 * but nothing is copied into the Texte table: the tool reads the chosen page directly.
 *
 * A chosen page is fetched live so its headings survive (the crawl stores plain text only)
 * and goes through the same HTML import as an uploaded .html file, narrowed to `<main>` or
 * `<article>` when the page has one. Only URLs from the organisation's own crawl are
 * fetched. If the live fetch fails, the stored crawl text is used instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

import { crawlPageSlug, planCrawlContentPages, type PlannedCrawlPage } from "@/lib/dt/content/crawl-pages";
import { loadContentCityCandidates } from "@/lib/dt/content/route-helpers";
import { loadCrawledSitePages } from "@/lib/dt/content/store";
import { PAGE_TIMEOUT_MS, USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";
import {
  TEXT_TOOL_MAX_FILE_BYTES,
  blocksFromDocument,
  extractUploadedDocument,
  type IngestResult,
  type IngestedText,
  type UploadedDocument,
} from "@/lib/dt/text-tools/ingest";

/** One row of the page table in the tools. */
export type CrawlSourcePage = Pick<PlannedCrawlPage, "name" | "path" | "level" | "page_type" | "pillar_name" | "crawled_at"> & {
  url: string;
};

export type CrawlSourcePagesResult = {
  pages: CrawlSourcePage[];
  skipped: { excluded: number; empty: number; redirected: number; duplicate: number; over_limit: number };
};

/** The crawled pages in the order and with the names and guessed types Texte gives them. */
export function crawlSourcePagesFrom(plan: ReturnType<typeof planCrawlContentPages>): CrawlSourcePagesResult {
  return {
    pages: plan.inserts.map((p) => ({
      url: p.source_url,
      name: p.name,
      path: p.path,
      level: p.level,
      page_type: p.page_type,
      pillar_name: p.pillar_name,
      crawled_at: p.crawled_at,
    })),
    skipped: plan.skipped,
  };
}

export async function loadCrawlSourcePages(service: SupabaseClient, organisationId: string): Promise<CrawlSourcePagesResult> {
  const [rows, cities] = await Promise.all([
    loadCrawledSitePages(service, organisationId),
    loadContentCityCandidates(service, organisationId),
  ]);
  return crawlSourcePagesFrom(planCrawlContentPages([], rows, { cities }));
}

/**
 * A fetched page narrowed to its main content: `<main>` (or `[role=main]`), else the
 * `<article>` that holds the page's H1, else the whole body (nav, header and footer are
 * dropped by the import anyway). A blog teaser `<article>` therefore never replaces the page.
 * `<head>` stays, so title and meta description are read as from an uploaded .html file.
 */
export function mainContentHtml(html: string): string {
  const $ = cheerio.load(html);
  const main = $("main, [role=main]").first();
  const articleWithH1 = $("article").filter((_, el) => $(el).find("h1").length > 0).first();
  const content = main.length && main.text().trim() ? main : articleWithH1.length ? articleWithH1 : null;
  if (!content) return html;
  const head = $("head").html() ?? "";
  return `<!DOCTYPE html><html><head>${head}</head><body>${$.html(content)}</body></html>`;
}

/**
 * The stored crawl text as a plain-text document: the H1 as Markdown heading, then the text
 * as it was stored (one line per element). Headings are not guessed from it: the crawl has
 * lost them, and guessing turned every short line into a section. Fallback only.
 */
export function storedCrawlText(row: { h1: string | null; title: string | null; text_content: string | null }): string {
  const heading = (row.h1 || row.title || "").replace(/\s+/g, " ").trim();
  const lines = (row.text_content ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (heading && lines[0] === heading) lines.shift();
  const body = lines.join("\n");
  return heading ? `# ${heading}\n\n${body}` : body;
}

export type CrawledPageInput = {
  /** File-like name for the result and the export („leistungen-dach.html“). */
  fileName: string;
  /** The page name the crawl gives it (H1, title or path). */
  pageName: string;
  url: string;
  /** `live`: fetched now with headings; `crawl`: the stored crawl text (live fetch failed). */
  source: "live" | "crawl";
  document: UploadedDocument;
  ingested: IngestedText;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function fetchLiveHtml(url: string, fetchImpl: FetchLike): Promise<string | null> {
  if (!checkSafePublicUrl(url).ok) return null;
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > TEXT_TOOL_MAX_FILE_BYTES) return null;
    // The ingest decodes by extension and BOM like an upload; the crawl's own pages are UTF-8 in practice.
    const doc = await extractUploadedDocument("seite.html", bytes);
    return doc.ok ? doc.value.content : null;
  } catch {
    return null;
  }
}

/**
 * The chosen page as the tools read it. Refuses a URL that is not in the organisation's
 * crawl (so the route never fetches arbitrary addresses). Live HTML first; the stored crawl
 * text when the live page cannot be read or does not split into sections.
 */
export async function loadCrawledPageInput(
  service: SupabaseClient,
  organisationId: string,
  url: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<IngestResult<CrawledPageInput>> {
  const { data: row, error } = await service
    .from("dt_site_pages")
    .select("url, title, h1, text_content, is_excluded")
    .eq("organisation_id", organisationId)
    .eq("url", url)
    .maybeSingle();
  if (error) return { ok: false, message: `Die Seite konnte nicht geladen werden: ${error.message}` };
  if (!row || row.is_excluded) {
    return { ok: false, message: "Diese Seite gehört nicht (mehr) zum Crawl dieser Organisation. Bitte die Liste neu laden oder erneut crawlen." };
  }

  const page = { url: String(row.url), title: (row.title as string | null) ?? null, h1: (row.h1 as string | null) ?? null, text_content: (row.text_content as string | null) ?? null };
  const pathname = (() => {
    try {
      return new URL(page.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "/";
    }
  })();
  const pageName = (page.h1 || page.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || (pathname === "/" ? "Startseite" : pathname);
  const fileName = `${crawlPageSlug(pathname, pageName)}.html`.slice(0, 260);

  const live = await fetchLiveHtml(page.url, options.fetchImpl ?? fetch);
  let liveError: string | null = null;
  if (live) {
    const document: UploadedDocument = { kind: "html", content: mainContentHtml(live), format: "web" };
    const ingested = blocksFromDocument(document, { fitToLimit: true });
    if (ingested.ok) return { ok: true, value: { fileName, pageName, url: page.url, source: "live", document, ingested: ingested.value } };
    liveError = ingested.message;
  }

  const text = storedCrawlText(page);
  if (!text.trim()) {
    return { ok: false, message: liveError ?? "Die Seite ist gerade nicht erreichbar, und der Crawl hat keinen Text von ihr. Bitte erneut crawlen." };
  }
  const document: UploadedDocument = { kind: "text", content: text, format: "web" };
  const ingested = blocksFromDocument(document, { fitToLimit: true });
  if (!ingested.ok) return { ok: false, message: liveError ?? ingested.message };
  return { ok: true, value: { fileName, pageName, url: page.url, source: "crawl", document, ingested: ingested.value } };
}
