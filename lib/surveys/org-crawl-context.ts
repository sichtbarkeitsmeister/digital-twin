import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { searchDtSitePages } from "@/lib/dt/seo/search-site-pages";
import type { OrgCrawlContext } from "@/lib/surveys/org-crawl-prefill";

export type { OrgCrawlContext, PrefillDraft, PrefillSource } from "@/lib/surveys/org-crawl-prefill";
export { suggestPrefillsFromCrawl } from "@/lib/surveys/org-crawl-prefill";

function cleanExcerpt(text: string, max = 900): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function loadOrgCrawlContext(
  organisationId: string,
): Promise<OrgCrawlContext> {
  const supabase = createServiceClient();

  const [{ data: org }, { data: config }, { count }, { data: topPages }] =
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
        .limit(12),
    ]);

  const organisationName = org?.name?.trim() || "Organisation";
  const websiteUrl = config?.website_url?.trim() || null;
  const pageCount = count ?? 0;

  const queries = [
    organisationName,
    "Über uns Leistungen Angebot Team",
    "Kontakt Standort Region Spezialisierung",
    "USP Philosophie Unterschied Wettbewerbsvorteil",
  ];
  const seen = new Set<string>();
  const snippets: OrgCrawlContext["snippets"] = [];

  for (const q of queries) {
    const hits = await searchDtSitePages(organisationId, q, 4);
    for (const hit of hits) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      snippets.push({
        url: hit.url,
        title: hit.title,
        snippet: hit.snippet,
      });
      if (snippets.length >= 12) break;
    }
    if (snippets.length >= 12) break;
  }

  const pageExcerpts: OrgCrawlContext["pageExcerpts"] = [];
  for (const row of topPages ?? []) {
    const title = (row.title || row.h1 || "").trim() || null;
    const parts = [
      row.meta_description?.trim() || "",
      row.h1?.trim() || "",
      row.text_content?.trim() || "",
    ].filter(Boolean);
    const text = cleanExcerpt(parts.join(" · "), 1200);
    if (!text) continue;
    pageExcerpts.push({
      url: row.url,
      title,
      text,
    });
  }

  const summaryText = [
    `Organisation: ${organisationName}`,
    websiteUrl ? `Website: ${websiteUrl}` : "Website: (noch nicht hinterlegt)",
    `Crawl-Seiten: ${pageCount}`,
    "",
    "### Suchtreffer",
    ...snippets.map(
      (s, i) => `[S${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.snippet}`,
    ),
    "",
    "### Seitenauszüge",
    ...pageExcerpts.map(
      (p, i) => `[P${i + 1}] ${p.title || p.url}\nURL: ${p.url}\n${p.text}`,
    ),
  ].join("\n");

  return {
    organisationId,
    organisationName,
    websiteUrl,
    pageCount,
    snippets,
    pageExcerpts,
    summaryText,
  };
}
