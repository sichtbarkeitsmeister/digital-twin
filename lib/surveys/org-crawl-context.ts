import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { getDtSitePageContent, searchDtSitePages } from "@/lib/dt/seo/search-site-pages";
import {
  formatDtSeoMonthlyStatsForPrompt,
  loadDtSeoMonthlyStats,
  computeSeoStatsSummary,
} from "@/lib/dt/seo/monthly-stats";
import type { OrgCrawlContext, OrgCrawlSeoMetrics } from "@/lib/surveys/org-crawl-prefill";
import {
  classifyCrawlPage,
  crawlPageKindLabel,
  crawlPagePriority,
} from "@/lib/surveys/org-crawl-prefill";

export type { OrgCrawlContext, PrefillDraft, PrefillSource } from "@/lib/surveys/org-crawl-prefill";
export { suggestPrefillsFromCrawl } from "@/lib/surveys/org-crawl-prefill";

function cleanExcerpt(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

const SEARCH_QUERIES = [
  "Über uns About Team Mitarbeiter Inhaber Geschäftsführung",
  "Leistungen Angebot Services Portfolio Performance",
  "Presse Pressemitteilung News Aktuelles Blog",
  "Kontakt Standort Region Spezialisierung Impressum Adresse",
  "USP Philosophie Unterschied Wettbewerbsvorteil",
  "Bewertungen Google Öffnungszeiten",
];

export async function loadOrgCrawlContext(
  organisationId: string,
): Promise<OrgCrawlContext> {
  const supabase = createServiceClient();

  const [{ data: org }, { data: config }, { count }, { data: topPages }, monthly] =
    await Promise.all([
      supabase.from("organisations").select("id, name").eq("id", organisationId).maybeSingle(),
      supabase
        .from("dt_org_config")
        .select("website_url")
        .eq("organisation_id", organisationId)
        .maybeSingle(),
      supabase
        .from("dt_site_pages")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .eq("is_excluded", false),
      supabase
        .from("dt_site_pages")
        .select("url,title,h1,meta_description,text_content")
        .eq("organisation_id", organisationId)
        .eq("is_excluded", false)
        .order("updated_at", { ascending: false })
        .limit(40),
      loadDtSeoMonthlyStats(supabase, organisationId, 12),
    ]);

  const organisationName = org?.name?.trim() || "Organisation";
  const websiteUrl = config?.website_url?.trim() || null;
  const pageCount = count ?? 0;

  const seen = new Set<string>();
  const snippets: OrgCrawlContext["snippets"] = [];

  const searchHits = await Promise.all(
    SEARCH_QUERIES.map((q) => searchDtSitePages(organisationId, q, 5)),
  );
  for (const hits of searchHits) {
    for (const hit of hits) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      snippets.push({
        url: hit.url,
        title: hit.title,
        snippet: hit.snippet,
      });
      if (snippets.length >= 16) break;
    }
    if (snippets.length >= 16) break;
  }

  const ranked = [...(topPages ?? [])].sort((a, b) => {
    const pa = crawlPagePriority(classifyCrawlPage(a.url, a.title || a.h1));
    const pb = crawlPagePriority(classifyCrawlPage(b.url, b.title || b.h1));
    return pb - pa;
  });

  const needFull = ranked
    .filter((row) => {
      const kind = classifyCrawlPage(row.url, row.title || row.h1);
      return kind !== "other" && (row.text_content?.trim().length ?? 0) < 400;
    })
    .slice(0, 4);
  const fullByUrl = new Map<string, string>();
  await Promise.all(
    needFull.map(async (row) => {
      const full = await getDtSitePageContent(organisationId, row.url, 3500);
      if (full?.content) fullByUrl.set(row.url, full.content);
    }),
  );

  const pageExcerpts: OrgCrawlContext["pageExcerpts"] = [];
  for (const row of ranked) {
    if (pageExcerpts.length >= 16) break;
    const title = (row.title || row.h1 || "").trim() || null;
    const kind = classifyCrawlPage(row.url, title);
    const max = kind === "other" ? 900 : 1800;
    const extra = fullByUrl.get(row.url);
    const text = cleanExcerpt(
      [
        row.meta_description?.trim() || "",
        row.h1?.trim() || "",
        extra || row.text_content?.trim() || "",
      ]
        .filter(Boolean)
        .join(" · "),
      max,
    );
    if (!text) continue;
    pageExcerpts.push({
      url: row.url,
      title: title ? `${crawlPageKindLabel(kind)}: ${title}` : crawlPageKindLabel(kind),
      text,
    });
  }

  const seoStatsText = formatDtSeoMonthlyStatsForPrompt(monthly);
  const summary = computeSeoStatsSummary(monthly);
  const latest = summary.latest;
  const seoMetrics: OrgCrawlSeoMetrics | null = latest
    ? {
        periodMonth: latest.period_month,
        impressions: latest.impressions,
        totalClicks: latest.total_clicks,
        aiClicks: latest.ai_clicks,
        rankingsTop10: latest.rankings_top10,
        rankingsTop3: latest.rankings_top3,
        visibilityIndex: latest.visibility_index,
        topKeywords: summary.topKeywords,
      }
    : null;

  const grouped = {
    press: pageExcerpts.filter((p) => p.title?.startsWith("Presse:")),
    about: pageExcerpts.filter((p) => p.title?.startsWith("Über uns:")),
    team: pageExcerpts.filter((p) => p.title?.startsWith("Team:")),
    services: pageExcerpts.filter((p) => p.title?.startsWith("Leistungen:")),
    legal: pageExcerpts.filter((p) => p.title?.startsWith("Impressum:")),
    other: pageExcerpts.filter(
      (p) =>
        !p.title?.startsWith("Presse:") &&
        !p.title?.startsWith("Über uns:") &&
        !p.title?.startsWith("Team:") &&
        !p.title?.startsWith("Leistungen:") &&
        !p.title?.startsWith("Impressum:"),
    ),
  };

  const block = (
    heading: string,
    pages: OrgCrawlContext["pageExcerpts"],
  ): string[] =>
    pages.length === 0
      ? []
      : [
          `### ${heading}`,
          ...pages.map(
            (p, i) => `[${heading.slice(0, 1)}${i + 1}] ${p.title || p.url}\nURL: ${p.url}\n${p.text}`,
          ),
        ];

  const summaryText = [
    `Organisation: ${organisationName}`,
    websiteUrl ? `Website: ${websiteUrl}` : "Website: (noch nicht hinterlegt)",
    `Crawl-Seiten: ${pageCount}`,
    "",
    "### SEO-/Performance-Daten",
    seoStatsText,
    "",
    "### Suchtreffer",
    ...snippets.map(
      (s, i) => `[S${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.snippet}`,
    ),
    "",
    ...block("Presse / Pressemitteilungen", grouped.press),
    ...block("Über uns", grouped.about),
    ...block("Team", grouped.team),
    ...block("Leistungen / Performance", grouped.services),
    ...block("Impressum / Rechtliches", grouped.legal),
    ...block("Weitere Seiten", grouped.other),
  ].join("\n");

  return {
    organisationId,
    organisationName,
    websiteUrl,
    pageCount,
    snippets,
    pageExcerpts,
    summaryText,
    seoStatsText,
    seoMetrics,
  };
}
