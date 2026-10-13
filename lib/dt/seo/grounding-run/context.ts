/**
 * Loads everything one Grounding step needs: the page, the Hub, the fact sources
 * (Anbieterfakten, Onboarding, crawled pages, live page), the Wunschkunden wording,
 * the editor's notes and the outputs of the earlier steps.
 */

import * as cheerio from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadContentAnbieterSources } from "@/lib/dt/content/load-sources";
import { loadOnboardingPromptText } from "@/lib/dt/onboarding/load-prompt";
import { USER_AGENT } from "@/lib/dt/seo/crawl-sitemap";
import { redirectedToSiteRoot } from "@/lib/dt/seo/discover-grounding-page-url";
import { DT_GROUNDING_PAGE_SELECT } from "@/lib/dt/seo/grounding-pages";
import type { GroundingRunContext, GroundingRunSitePage } from "@/lib/dt/seo/grounding-run/prompts";
import { groundingRunFacts, groundingRunNotes } from "@/lib/dt/seo/grounding-run/store";
import { checkSafePublicUrl } from "@/lib/shared/safe-fetch-url";
import { loadWunschkundenKnowledgeForSeo } from "@/lib/dt/seo/wunschkunden-knowledge";
import type { DtGroundingPageRow, DtGroundingStepRow } from "@/lib/dt/types";

const HUB_PAGE_LIMIT = 6;
const ENTITY_PAGE_LIMIT = 5;
const PAGE_TEXT_CHARS = 4_000;
const LIVE_PAGE_CHARS = 8_000;
const LIVE_FETCH_TIMEOUT_MS = 12_000;
const KEY_PATH_RE =
  /\/(ueber|uber|about|unternehmen|team|wir|leistung|service|angebot|kontakt|impressum|standort|philosophie|ablauf|preise|faq)/i;

type SitePageRow = { url: string; title: string | null; h1: string | null; text_content: string | null };

function pageText(row: SitePageRow): string {
  return (row.text_content ?? "").replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_CHARS);
}

function isHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

/** Hub: homepage + the pages that describe the organisation. Entity: pages that mention it. */
async function loadSitePages(
  service: SupabaseClient,
  organisationId: string,
  page: DtGroundingPageRow,
): Promise<GroundingRunSitePage[]> {
  const { data, error } = await service
    .from("dt_site_pages")
    .select("url, title, h1, text_content")
    .eq("organisation_id", organisationId)
    .eq("is_excluded", false)
    .order("url", { ascending: true })
    .limit(400);
  if (error || !data) return [];
  const rows = (data as SitePageRow[]).filter((r) => (r.text_content ?? "").trim().length > 200);

  if (page.kind === "hub") {
    const home = rows.filter((r) => isHomepage(r.url));
    const key = rows.filter((r) => !isHomepage(r.url) && KEY_PATH_RE.test(r.url));
    const rest = rows.filter((r) => !isHomepage(r.url) && !KEY_PATH_RE.test(r.url));
    return [...home, ...key, ...rest].slice(0, HUB_PAGE_LIMIT).map((r) => ({ url: r.url, title: r.title ?? r.h1, text: pageText(r) }));
  }

  const terms = (page.entity_name ?? page.slug ?? "")
    .toLowerCase()
    .split(/[\s/,-]+/)
    .filter((t) => t.length >= 3);
  const scored = rows
    .map((r) => {
      const hay = `${r.title ?? ""} ${r.h1 ?? ""} ${r.url} ${r.text_content ?? ""}`.toLowerCase();
      const score = terms.reduce((sum, t) => sum + (hay.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, ENTITY_PAGE_LIMIT);
  return scored.map(({ r }) => ({ url: r.url, title: r.title ?? r.h1, text: pageText(r) }));
}

/** Visible text of the page at `url`, or null when it does not exist (also: bounces to the homepage). */
export async function loadLiveGroundingPageText(url: string): Promise<string | null> {
  const safe = checkSafePublicUrl(url);
  if (!safe.ok) return null;
  try {
    const res = await fetch(safe.url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (res.url && redirectedToSiteRoot(safe.url.toString(), res.url)) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, header, footer").remove();
    const text = ($("main").text() || $("body").text()).replace(/\s+/g, " ").trim();
    return text.length > 100 ? text.slice(0, LIVE_PAGE_CHARS) : null;
  } catch {
    return null;
  }
}

export async function loadGroundingRunContext(
  service: SupabaseClient,
  page: DtGroundingPageRow,
  steps: readonly DtGroundingStepRow[],
): Promise<GroundingRunContext> {
  const organisationId = page.organisation_id;
  const [{ data: organisation }, { data: config }, { data: siblingRows }, anbieter, onboardingText, wunschkundenText, sitePages, livePageText] =
    await Promise.all([
      service.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
      service.from("dt_org_config").select("display_name, website_url").eq("organisation_id", organisationId).maybeSingle(),
      service.from("dt_grounding_pages").select(DT_GROUNDING_PAGE_SELECT).eq("organisation_id", organisationId),
      loadContentAnbieterSources(service, organisationId).catch(() => ({ sections: [] as GroundingRunContext["anbieterSections"] })),
      loadOnboardingPromptText(organisationId).catch(() => ""),
      loadWunschkundenKnowledgeForSeo(service, organisationId).catch(() => ""),
      loadSitePages(service, organisationId, page),
      loadLiveGroundingPageText(page.url),
    ]);

  const organisationName =
    (config?.display_name as string | null | undefined)?.trim() ||
    (organisation?.name as string | null | undefined)?.trim() ||
    "";
  const siblings = ((siblingRows ?? []) as DtGroundingPageRow[]).filter((r) => r.id !== page.id);
  const hubRow = page.kind === "hub" ? null : (siblings.find((r) => r.kind === "hub") ?? null);

  const outputs: GroundingRunContext["outputs"] = {};
  for (const row of steps) {
    if (row.status === "done" || row.status === "waiting") outputs[row.step] = row.output;
  }

  return {
    organisationName,
    websiteUrl: (config?.website_url as string | null | undefined)?.trim() || null,
    page: {
      kind: page.kind,
      entityName: page.kind === "hub" ? organisationName || page.entity_name || "Organisation" : page.entity_name || page.slug || "Entität",
      slug: page.slug,
      url: page.url,
      schemaType: page.entity_type,
    },
    hub: hubRow ? { url: hubRow.url, facts: groundingRunFacts(hubRow) } : null,
    siblings: siblings.map((r) => ({ kind: r.kind, entityName: r.kind === "hub" ? organisationName : r.entity_name, url: r.url })),
    anbieterSections: anbieter.sections,
    onboardingText,
    wunschkundenText,
    sitePages,
    livePageText,
    notes: groundingRunNotes(page),
    outputs,
    html: page.html,
    today: new Date().toISOString().slice(0, 10),
  };
}
