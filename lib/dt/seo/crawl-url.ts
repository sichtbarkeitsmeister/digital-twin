/**
 * URL helpers for the site crawler and GSC matching.
 * Kept free of Node/cheerio so client components can reuse them.
 */

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

/** Hostname without leading `www.` for same-site comparisons. */
export function crawlHostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * True when a candidate URL belongs to the same site as `origin`.
 * Treats www/non-www and http/https as the same site so mixed canonicals
 * (common vs. Search Console) are not dropped from the frontier.
 */
export function isSameCrawlSite(candidateUrl: string, origin: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const site = new URL(origin);
    if (!/^https?:$/.test(candidate.protocol)) return false;
    return crawlHostKey(candidate.hostname) === crawlHostKey(site.hostname);
  } catch {
    return false;
  }
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

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/** Extract `<loc>` values from sitemap XML, including CDATA and entities. */
export function extractSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+))\s*<\/loc>/gi;
  for (const match of xml.matchAll(re)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw) continue;
    locs.push(decodeXmlEntities(raw).trim());
  }
  return locs;
}
