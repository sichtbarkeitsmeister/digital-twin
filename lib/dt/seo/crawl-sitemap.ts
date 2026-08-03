import * as cheerio from "cheerio";
import { gunzipSync } from "node:zlib";

import { isDtExcludedPageUrl } from "@/lib/dt/seo/build-seo-context";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; DigitalTwin-SBKM-Crawler/1.0; +https://www.digital-twin-sbkm.de)";
export const PAGE_TIMEOUT_MS = 15_000;
// Store the full page text. Cap only as a sanity guard against pathological
// pages; normal pages are stored in full. Retrieval into the LLM context is
// done on-demand (see lib/dt/seo/search-site-pages.ts), so this does not burn
// tokens.
export const TEXT_LIMIT = 200_000;
/** Upper bound when expanding sitemaps (not a crawl budget — that lives on dt_site_crawls.max_pages). */
export const SITEMAP_URL_LIMIT = 50_000;

const COMMON_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/wp-sitemap.xml",
];

export type DtCrawledPage = {
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  text_content: string | null;
  is_excluded: boolean;
};

type ParsedPage = {
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  text_content: string | null;
  links: string[];
};

/**
 * Normalise a URL for frontier deduplication: lowercase host, strip default ports,
 * drop trailing slash (except root), drop index.html/index.php, strip tracking params.
 */
export function normaliseUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    if (/\/index\.(html?|php)$/i.test(pathname)) {
      pathname = pathname.replace(/\/index\.(html?|php)$/i, "") || "/";
    }
    u.pathname = pathname;
    return u.toString();
  } catch {
    return null;
  }
}

function isCrawlableLink(resolved: URL, origin: string): boolean {
  if (resolved.origin !== origin) return false;
  if (!/^https?:$/.test(resolved.protocol)) return false;
  if (
    /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|pdf|zip|rar|gz|mp4|mp3|wav|mov|avi|css|js|json|xml|woff2?|ttf|eot)$/i.test(
      resolved.pathname,
    )
  ) {
    return false;
  }
  return true;
}

async function fetchSitemapBody(sitemapUrl: string): Promise<string> {
  // A sitemap index can point anywhere, including internal addresses.
  const safe = checkSafePublicUrl(sitemapUrl);
  if (!safe.ok) throw new Error(safe.reason);

  const res = await fetch(sitemapUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Sitemap nicht erreichbar (${res.status}).`);

  const buf = Buffer.from(await res.arrayBuffer());
  const encoding = (res.headers.get("content-encoding") ?? "").toLowerCase();
  const isGzip =
    encoding.includes("gzip") ||
    sitemapUrl.toLowerCase().endsWith(".gz") ||
    (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);

  if (isGzip) {
    return gunzipSync(buf).toString("utf-8");
  }
  return buf.toString("utf-8");
}

/**
 * Discover sitemap URLs: configured URL first, then robots.txt Sitemap: lines,
 * then common paths.
 */
export async function discoverSitemaps(
  origin: string,
  configuredSitemapUrl?: string | null,
): Promise<string[]> {
  const found = new Set<string>();

  if (configuredSitemapUrl?.trim()) {
    found.add(configuredSitemapUrl.trim());
    return [...found];
  }

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (robotsRes.ok) {
      const text = await robotsRes.text();
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
        if (m?.[1]) found.add(m[1].trim());
      }
    }
  } catch {
    /* robots.txt optional */
  }

  if (found.size > 0) return [...found];

  for (const path of COMMON_SITEMAP_PATHS) {
    const url = `${origin}${path}`;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("xml") || ct.includes("text") || ct.includes("octet-stream")) {
          found.add(url);
          break;
        }
      }
    } catch {
      /* try next path */
    }
  }

  return [...found];
}

export async function fetchUrlsFromSitemap(
  sitemapUrl: string,
  depth = 0,
  collected: string[] = [],
): Promise<string[]> {
  if (depth > 10 || collected.length >= SITEMAP_URL_LIMIT) return collected;

  const xml = await fetchSitemapBody(sitemapUrl);
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
  const unique = [...new Set(locs)];

  if (xml.includes("<sitemapindex")) {
    for (const sub of unique) {
      if (collected.length >= SITEMAP_URL_LIMIT) break;
      try {
        await fetchUrlsFromSitemap(sub, depth + 1, collected);
      } catch {
        /* skip broken child sitemap */
      }
    }
    return collected;
  }

  for (const loc of unique) {
    if (collected.length >= SITEMAP_URL_LIMIT) break;
    const n = normaliseUrl(loc);
    if (n && !collected.includes(n)) collected.push(n);
  }

  return collected;
}

export function parsePage(html: string, pageUrl: string, origin: string): ParsedPage {
  const $ = cheerio.load(html);

  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim() || null;

  const meta_description =
    $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    $('meta[property="og:description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    null;

  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalised = normaliseUrl(href, pageUrl);
    if (!normalised) return;
    try {
      const resolved = new URL(normalised);
      if (isCrawlableLink(resolved, origin)) links.add(normalised);
    } catch {
      /* ignore */
    }
  });

  $("script, style, noscript, template, svg, iframe").remove();
  const rawText = $("main").length
    ? $("main").text()
    : $("body").length
      ? $("body").text()
      : $("html").text();
  const text_content =
    rawText
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, TEXT_LIMIT) || null;

  return {
    title: title?.slice(0, 200) ?? null,
    h1: h1?.slice(0, 300) ?? null,
    meta_description: meta_description?.slice(0, 500) ?? null,
    text_content,
    links: [...links],
  };
}

function decodeHtml(buf: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buf);
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();

  if (!charset) {
    const head = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ||
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }

  const normalised =
    !charset || charset === "iso-8859-1" || charset === "latin1"
      ? charset === "iso-8859-1" || charset === "latin1"
        ? "windows-1252"
        : "utf-8"
      : charset;

  try {
    return new TextDecoder(normalised).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchPageOnce(
  url: string,
  origin: string,
): Promise<{ page: Omit<DtCrawledPage, "url" | "is_excluded">; links: string[] } | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    redirect: "follow",
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && contentType.includes("text/html")) {
    const html = decodeHtml(await res.arrayBuffer(), contentType);
    const parsed = parsePage(html, url, origin);
    return {
      page: {
        title: parsed.title,
        h1: parsed.h1,
        meta_description: parsed.meta_description,
        text_content: parsed.text_content,
      },
      links: parsed.links,
    };
  }
  return null;
}

/** Fetch and parse a single page; retries once on network/timeout errors. */
export async function fetchAndParse(
  url: string,
  origin: string,
): Promise<{ page: Omit<DtCrawledPage, "url" | "is_excluded">; links: string[] }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await fetchPageOnce(url, origin);
      if (result) return result;
      break;
    } catch {
      if (attempt === 1) break;
    }
  }
  return {
    page: { title: null, h1: null, meta_description: null, text_content: null },
    links: [],
  };
}

/** Expand all discovered sitemaps into normalised seed URLs. */
export async function expandSitemapSeeds(
  origin: string,
  configuredSitemapUrl?: string | null,
): Promise<{ seeds: string[]; sitemapCount: number }> {
  const sitemapUrls = await discoverSitemaps(origin, configuredSitemapUrl);
  const seeds = new Set<string>();

  for (const sm of sitemapUrls) {
    try {
      const urls = await fetchUrlsFromSitemap(sm);
      for (const u of urls) {
        const n = normaliseUrl(u);
        if (n) seeds.add(n);
      }
    } catch {
      /* skip broken sitemap */
    }
  }

  return { seeds: [...seeds], sitemapCount: seeds.size };
}

export function toCrawledPage(url: string, origin: string): DtCrawledPage | null {
  const excluded = isDtExcludedPageUrl(url);
  if (excluded) {
    return {
      url,
      title: null,
      h1: null,
      meta_description: null,
      text_content: null,
      is_excluded: true,
    };
  }
  return null;
}

export function resolveOrigin(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl?.trim()) return null;
  const n = normaliseUrl(websiteUrl.trim());
  if (!n) return null;
  try {
    return new URL(n).origin;
  } catch {
    return null;
  }
}
