/**
 * Bounded crawl of the pages that carry an organisation's core facts: home, Impressum,
 * Kontakt, Über uns, Team, Leistungen (+ direct subpages), Standorte, FAQ, Referenzen.
 * Fresh `dt_site_pages` rows are reused; the rest is fetched live through safeFetchText.
 * Impressum is read on purpose even though SEO analysis skips legal pages.
 */

import * as cheerio from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isCrawlablePageUrl, looksLikeSitemapXml, parsePage } from "@/lib/dt/seo/crawl-sitemap";
import { extractSitemapLocs, isSameCrawlSite, normaliseUrl } from "@/lib/dt/seo/crawl-url";
import { HTML_ACCEPT, TEXT_ACCEPT, safeFetchText } from "@/lib/dt/seo/grounding-check/fetch";

export const KEY_PAGE_CATEGORIES = [
  "home",
  "impressum",
  "contact",
  "about",
  "team",
  "services",
  "locations",
  "faq",
  "references",
] as const;
export type KeyPageCategory = (typeof KEY_PAGE_CATEGORIES)[number];

export const KEY_PAGE_LIMITS: Record<KeyPageCategory, number> = {
  home: 1,
  impressum: 2,
  contact: 2,
  about: 4,
  team: 3,
  services: 16,
  locations: 6,
  faq: 2,
  references: 3,
};
export const MAX_KEY_PAGES = 35;
/** dt_site_pages rows younger than this are used instead of a live fetch. */
export const SITE_PAGE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Always fetched live (cache only as fallback): the fact-dense pages. */
const LIVE_CATEGORIES = new Set<KeyPageCategory>(["impressum", "contact"]);
const PAGE_TEXT_LIMIT = 12_000;
const JSON_LD_LIMIT = 6_000;
const PAGE_TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;
const MIN_INVENTORY_BEFORE_SITEMAP = 12;

const CATEGORY_PATTERNS: Array<[Exclude<KeyPageCategory, "home">, RegExp]> = [
  ["impressum", /(impressum|imprint|legal-notice|anbieterkennzeichnung)/],
  ["contact", /(kontakt|contact|anfahrt)/],
  ["faq", /(^|\/)(faq|haeufige-fragen|häufige-fragen|fragen-und-antworten|fragen)(\/|$)/],
  ["team", /(team|mitarbeiter|ansprechpartner|unsere-aerzte|unsere-ärzte|aerzte|ärzte|anwaelte|anwälte|geschaeftsfuehrung|geschäftsführung|inhaber|people)/],
  ["locations", /(standort|filiale|niederlassung|zweigstelle|location|praxen)/],
  ["references", /(referenz|kundenstimmen|bewertung|erfahrung|testimonial|(^|\/)cases?(\/|$)|projekte|portfolio|auszeichnung|zertifi)/],
  ["about", /(ueber-uns|uber-uns|über-uns|about|unternehmen|wir-ueber-uns|philosophie|geschichte|historie|mission|vision|leitbild|qualitaet|qualität)/],
  ["services", /(leistung|services?(\/|$)|angebot|produkt|product|behandlung|therapie|schwerpunkt|taetigkeit|tätigkeit|rechtsgebiet|fachgebiet|loesung|lösung|solution|dienstleistung)/],
];

const EXCLUDED_PATTERN =
  /(datenschutz|privacy|(^|\/)agb(\/|$)|widerruf|cookie|newsletter|login|warenkorb|cart|checkout|karriere|(^|\/)jobs?(\/|$)|stellenangebot|(^|\/)blog(\/|$)|(^|\/)news(\/|$)|aktuelles|presse|magazin|ratgeber|(^|\/)wiki(\/|$)|(^|\/)tag(\/|$)|category|kategorie|(^|\/)author(\/|$)|\/page\/\d+|(^|\/)feed(\/|$)|sitemap|(^|\/)suche(\/|$)|search|grounding|llms|(^|\/)\d{4}\/\d{2}(\/|$))/;

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return "";
  }
}

function depthOf(url: string): number {
  return pathOf(url).split("/").filter(Boolean).length;
}

/** Category of a URL by path (and title for legal/contact pages); null = not a key page. */
export function classifyKeyPage(url: string, title?: string | null): KeyPageCategory | "excluded" | null {
  const path = pathOf(url);
  if (path === "/" || path === "") return "home";
  if (EXCLUDED_PATTERN.test(path)) return "excluded";
  // The last segment decides first: /unternehmen/leistungen/ is a services page.
  const last = `/${path.split("/").filter(Boolean).at(-1) ?? ""}/`;
  for (const target of [last, path]) {
    for (const [category, pattern] of CATEGORY_PATTERNS) {
      if (pattern.test(target)) return category;
    }
  }
  const t = (title ?? "").toLowerCase();
  if (/^impressum\b/.test(t)) return "impressum";
  if (/^kontakt\b/.test(t)) return "contact";
  if (/^(über uns|ueber uns|about)\b/.test(t)) return "about";
  if (/^team\b/.test(t)) return "team";
  return null;
}

export type InventoryItem = {
  url: string;
  title?: string | null;
  /** Linked from the header / main navigation of the homepage. */
  inNav?: boolean;
  /** Position in discovery order (nav links first). */
  order: number;
};

export type SelectedKeyPage = { url: string; category: KeyPageCategory };

/**
 * Pick at most MAX_KEY_PAGES same-site pages. Navigation links that fit no category count as
 * service hubs (many sites put services at top level); direct subpages of the chosen hubs
 * fill the rest of the service budget. Pure.
 */
export function selectKeyPages(
  items: InventoryItem[],
  input: { origin: string; homeUrl: string; excludeUrls?: string[] },
): SelectedKeyPage[] {
  const exclude = new Set((input.excludeUrls ?? []).map((u) => normaliseUrl(u)).filter(Boolean) as string[]);
  const home = normaliseUrl(input.homeUrl) ?? input.homeUrl;
  const byUrl = new Map<string, InventoryItem>();
  for (const item of items) {
    const url = normaliseUrl(item.url);
    if (!url || exclude.has(url)) continue;
    if (!isSameCrawlSite(url, input.origin) || !isCrawlablePageUrl(url, input.origin)) continue;
    const prev = byUrl.get(url);
    byUrl.set(url, {
      url,
      title: prev?.title ?? item.title ?? null,
      inNav: Boolean(prev?.inNav || item.inNav),
      order: Math.min(prev?.order ?? Number.MAX_SAFE_INTEGER, item.order),
    });
  }

  const rank = (a: InventoryItem, b: InventoryItem) =>
    Number(Boolean(b.inNav)) - Number(Boolean(a.inNav)) || depthOf(a.url) - depthOf(b.url) || a.order - b.order;

  const buckets = new Map<KeyPageCategory, InventoryItem[]>();
  const uncategorised: InventoryItem[] = [];
  for (const item of byUrl.values()) {
    if (item.url === home) continue;
    const category = classifyKeyPage(item.url, item.title);
    if (category === "excluded" || category === "home") continue;
    if (category) {
      buckets.set(category, [...(buckets.get(category) ?? []), item]);
    } else if (item.inNav && depthOf(item.url) <= 2) {
      buckets.set("services", [...(buckets.get("services") ?? []), item]);
    } else {
      uncategorised.push(item);
    }
  }

  const selected: SelectedKeyPage[] = [{ url: home, category: "home" }];
  const taken = new Set([home]);
  const take = (category: KeyPageCategory, candidates: InventoryItem[], limit: number) => {
    let n = selected.filter((s) => s.category === category).length;
    for (const item of [...candidates].sort(rank)) {
      if (n >= limit || selected.length >= MAX_KEY_PAGES) break;
      if (taken.has(item.url)) continue;
      taken.add(item.url);
      selected.push({ url: item.url, category });
      n += 1;
    }
  };

  for (const category of KEY_PAGE_CATEGORIES) {
    if (category === "home") continue;
    if (category === "services") {
      // Hubs first (at most half the budget), then their direct subpages.
      take("services", buckets.get("services") ?? [], Math.ceil(KEY_PAGE_LIMITS.services / 2));
      const hubs = selected.filter((s) => s.category === "services").map((s) => pathOf(s.url).replace(/\/+$/, ""));
      const children = [...(buckets.get("services") ?? []), ...uncategorised].filter((item) => {
        const path = pathOf(item.url).replace(/\/+$/, "");
        return hubs.some((hub) => hub && path.startsWith(`${hub}/`) && !path.slice(hub.length + 1).includes("/"));
      });
      take("services", children, KEY_PAGE_LIMITS.services);
      take("services", buckets.get("services") ?? [], KEY_PAGE_LIMITS.services);
      continue;
    }
    take(category, buckets.get(category) ?? [], KEY_PAGE_LIMITS[category]);
  }
  return selected;
}

/** JSON-LD blocks of a page as compact JSON strings; invalid blocks are skipped. */
export function extractJsonLdBlocks(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const compact = JSON.stringify(JSON.parse(raw));
      out.push(compact.length > JSON_LD_LIMIT ? `${compact.slice(0, JSON_LD_LIMIT)}…` : compact);
    } catch {
      /* invalid JSON-LD on the customer site: ignore */
    }
  });
  return out;
}

/** Same-site links of the homepage; header/nav links flagged. */
export function homepageLinks(html: string, pageUrl: string, origin: string): InventoryItem[] {
  const $ = cheerio.load(html);
  const nav = new Set<string>();
  $("header a[href], nav a[href], [role='navigation'] a[href]").each((_, el) => {
    const n = normaliseUrl($(el).attr("href") ?? "", pageUrl);
    if (n) nav.add(n);
  });
  const parsed = parsePage(html, pageUrl, origin);
  return parsed.links.map((url, i) => ({ url, inNav: nav.has(url), order: nav.has(url) ? i : 1_000 + i }));
}

const PROFILE_HOSTS = /(^|\.)(linkedin\.com|xing\.com|instagram\.com|facebook\.com|youtube\.com|tiktok\.com|x\.com|twitter\.com|pinterest\.[a-z.]+|wikipedia\.org|wikidata\.org)$/i;

/** Links to the organisation's own profiles (page text has no URLs, so they are listed for quoting). */
export function profileLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href") ?? "", pageUrl);
      if (!/^https?:$/.test(u.protocol) || !PROFILE_HOSTS.test(u.hostname)) return;
      if (/\/(sharer|share|intent|dialog)\b/i.test(u.pathname) || u.pathname.length <= 1) return;
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* ignore */
    }
  });
  return [...out].slice(0, 12);
}

const BLOCK_SELECTOR =
  "p, div, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, tr, section, article, address, blockquote, br, figcaption, span.elementor-icon-list-text";

/**
 * Readable text of a page or fragment: line breaks between block elements (cheerio's
 * .text() glues „Straße 40“ and „59063 Hamm“ into „4059063“), no menus.
 */
export function readableText(html: string, opts: { stripChrome?: boolean } = {}): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, iframe, form, button, select").remove();
  if (opts.stripChrome !== false) $("header, nav, footer, [role='navigation'], [role='banner'], .menu, .sub-menu").remove();
  $(BLOCK_SELECTOR).each((_, el) => {
    $(el).append("\n");
  });
  const scope = $("main").length ? "main" : $("body").length ? "body" : null;
  return (scope ? $(scope).text() : $.root().text())
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Text of the homepage: profile links and footer (address, phone) first, so clipping a
 * long page never drops them.
 */
export function homePageText(main: string | null | undefined, footer: string, profiles: string[]): string {
  const extras = [profiles.length > 0 ? `[Profile] ${profiles.join(" ")}` : "", footer ? `[Footer] ${footer}` : ""].filter(Boolean).join("\n");
  const room = Math.max(0, PAGE_TEXT_LIMIT - extras.length - 1);
  return [extras, clipText(main).slice(0, room)].filter(Boolean).join("\n");
}

function footerText(html: string): string {
  const $ = cheerio.load(html);
  const footer = $("footer").toArray().map((el) => $.html(el)).join("\n");
  return footer ? readableText(`<body>${footer}</body>`, { stripChrome: false }).replace(/\n/g, " · ").slice(0, 2_500) : "";
}

export type CrawledKeyPage = {
  url: string;
  finalUrl: string;
  category: KeyPageCategory;
  title: string | null;
  text: string;
  source: "cache" | "live";
  jsonLd: string[];
};

export type CrawlFailure = { url: string; category: KeyPageCategory; reason: string };

export type WebsiteCollection = {
  origin: string;
  homeUrl: string;
  homeHtml: string;
  pages: CrawledKeyPage[];
  failed: CrawlFailure[];
  robotsTxt: string | null;
  inventorySize: number;
  sitemapUsed: boolean;
};

type SitePageRow = {
  url: string;
  final_url: string | null;
  title: string | null;
  h1: string | null;
  text_content: string | null;
  crawled_at: string | null;
};

async function loadSitePageRows(service: SupabaseClient, organisationId: string): Promise<SitePageRow[]> {
  const { data, error } = await service
    .from("dt_site_pages")
    .select("url, final_url, title, h1, text_content, crawled_at")
    .eq("organisation_id", organisationId)
    .limit(1500);
  if (error) {
    console.warn("[grounding-check] dt_site_pages not readable:", error.message);
    return [];
  }
  return (data ?? []) as SitePageRow[];
}

/** Sitemap URLs from robots.txt and the usual paths, bounded; every fetch is checked. */
async function sitemapInventory(origin: string, robotsTxt: string | null, deadline: number): Promise<InventoryItem[]> {
  const candidates = [
    ...(robotsTxt ?? "")
      .split(/\r?\n/)
      .map((line) => /^\s*sitemap:\s*(\S+)/i.exec(line)?.[1])
      .filter((u): u is string => Boolean(u)),
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap.xml`,
  ].filter((u, i, all) => all.indexOf(u) === i && !/\.gz$/i.test(u));

  const urls: string[] = [];
  const queue = [...candidates];
  let fetched = 0;
  while (queue.length > 0 && fetched < 8 && urls.length < 2_000 && Date.now() < deadline) {
    const sitemapUrl = queue.shift()!;
    fetched += 1;
    const res = await safeFetchText(sitemapUrl, { accept: "application/xml,text/xml,*/*", timeoutMs: 8_000 });
    if (!res?.ok || !looksLikeSitemapXml(res.body)) continue;
    const locs = extractSitemapLocs(res.body);
    if (res.body.includes("<sitemapindex")) {
      // Page sitemaps before post sitemaps.
      queue.unshift(...locs.filter((u) => !/\.gz$/i.test(u)).sort((a, b) => Number(/page/i.test(b)) - Number(/page/i.test(a))).slice(0, 5));
      continue;
    }
    urls.push(...locs);
    if (urls.length > 0) break;
  }
  return urls.slice(0, 2_000).map((url, i) => ({ url, order: 5_000 + i }));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function clipText(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  return t.length > PAGE_TEXT_LIMIT ? t.slice(0, PAGE_TEXT_LIMIT) : t;
}

/**
 * Crawl the key pages of the website. Throws when the homepage itself is not reachable.
 * `deadline` (epoch ms) stops new fetches; pages not reached are listed as failures.
 */
export async function collectWebsite(
  service: SupabaseClient,
  input: { organisationId: string; websiteUrl: string; excludeUrls: string[]; deadline: number; now?: number },
): Promise<WebsiteCollection> {
  const now = input.now ?? Date.now();
  const home = await safeFetchText(input.websiteUrl, { accept: HTML_ACCEPT, timeoutMs: 15_000 });
  if (!home || !home.ok || !/html/i.test(home.contentType)) {
    throw new Error(
      home ? `Die Website antwortet mit HTTP ${home.status}.` : "Die Website ist nicht erreichbar oder die Adresse ist nicht erlaubt.",
    );
  }
  const origin = new URL(home.finalUrl).origin;
  const homeUrl = normaliseUrl(home.finalUrl) ?? home.finalUrl;

  const [robots, rows] = await Promise.all([
    safeFetchText(`${origin}/robots.txt`, { accept: TEXT_ACCEPT, timeoutMs: 8_000 }),
    loadSitePageRows(service, input.organisationId),
  ]);
  const robotsTxt = robots?.ok && !/html/i.test(robots.contentType) ? robots.body : null;

  const inventory: InventoryItem[] = [
    ...homepageLinks(home.body, home.finalUrl, origin),
    ...rows.map((r, i) => ({ url: r.final_url || r.url, title: r.title ?? r.h1, order: 2_000 + i })),
  ];
  let sitemapUsed = false;
  if (new Set(inventory.map((i) => i.url)).size < MIN_INVENTORY_BEFORE_SITEMAP) {
    inventory.push(...(await sitemapInventory(origin, robotsTxt, Math.min(input.deadline, Date.now() + 20_000))));
    sitemapUsed = true;
  }

  const selected = selectKeyPages(inventory, { origin, homeUrl, excludeUrls: input.excludeUrls });
  const cache = new Map<string, SitePageRow>();
  for (const row of rows) {
    for (const u of [row.url, row.final_url]) {
      const n = u ? normaliseUrl(u) : null;
      if (n) cache.set(n, row);
    }
  }

  const homeParsed = parsePage(home.body, home.finalUrl, origin);
  const footer = footerText(home.body);
  const profiles = profileLinks(home.body, home.finalUrl);
  const pages: CrawledKeyPage[] = [
    {
      url: homeUrl,
      finalUrl: home.finalUrl,
      category: "home",
      title: homeParsed.title,
      text: homePageText(readableText(home.body) || homeParsed.text_content, footer, profiles),
      source: "live",
      jsonLd: extractJsonLdBlocks(home.body),
    },
  ];
  const failed: CrawlFailure[] = [];

  const rest = selected.filter((s) => s.category !== "home");
  const results = await mapLimit(rest, CONCURRENCY, async (target): Promise<CrawledKeyPage | CrawlFailure> => {
    const row = cache.get(target.url);
    const fresh = row?.crawled_at && now - new Date(row.crawled_at).getTime() < SITE_PAGE_FRESH_MS;
    const cached: CrawledKeyPage | null =
      row && fresh && (row.text_content ?? "").trim().length >= 120
        ? {
            url: target.url,
            finalUrl: row.final_url || row.url,
            category: target.category,
            title: row.title ?? row.h1,
            text: clipText(row.text_content),
            source: "cache",
            jsonLd: [],
          }
        : null;
    // Stored text glues block elements („Straße 4059063 Hamm“): Impressum and Kontakt carry
    // the core facts, so they are read live and the cache only stands in when that fails.
    if (cached && !LIVE_CATEGORIES.has(target.category)) return cached;
    if (Date.now() + PAGE_TIMEOUT_MS > input.deadline) {
      return cached ?? { url: target.url, category: target.category, reason: "Zeitlimit des Durchlaufs erreicht" };
    }
    const res = await safeFetchText(target.url, { accept: HTML_ACCEPT, timeoutMs: PAGE_TIMEOUT_MS });
    if (cached && (!res || !res.ok || !/html/i.test(res.contentType))) return cached;
    if (!res) return { url: target.url, category: target.category, reason: "nicht erreichbar" };
    if (!res.ok) return { url: target.url, category: target.category, reason: `HTTP ${res.status}` };
    if (!/html/i.test(res.contentType)) return { url: target.url, category: target.category, reason: "kein HTML" };
    if (!isSameCrawlSite(res.finalUrl, origin)) return { url: target.url, category: target.category, reason: "leitet auf eine andere Domain" };
    const parsed = parsePage(res.body, res.finalUrl, origin);
    return {
      url: target.url,
      finalUrl: res.finalUrl,
      category: target.category,
      title: parsed.title,
      text: clipText(readableText(res.body) || parsed.text_content),
      source: "live",
      jsonLd: extractJsonLdBlocks(res.body),
    };
  });

  const seenFinal = new Set([normaliseUrl(home.finalUrl)]);
  for (const result of results) {
    if ("reason" in result) {
      failed.push(result);
      continue;
    }
    const finalKey = normaliseUrl(result.finalUrl);
    if (finalKey && seenFinal.has(finalKey)) continue;
    seenFinal.add(finalKey);
    if (result.text.length < 40) {
      failed.push({ url: result.url, category: result.category, reason: "kein lesbarer Text" });
      continue;
    }
    pages.push(result);
  }

  return {
    origin,
    homeUrl,
    homeHtml: home.body,
    pages,
    failed,
    robotsTxt,
    inventorySize: new Set(inventory.map((i) => i.url)).size,
    sitemapUsed,
  };
}
