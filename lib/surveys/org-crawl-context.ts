import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { searchDtSitePages } from "@/lib/dt/seo/search-site-pages";
import type { CoreQuestionPrefillHint } from "@/lib/surveys/core-question-templates";

export type OrgCrawlContext = {
  organisationId: string;
  organisationName: string;
  websiteUrl: string | null;
  pageCount: number;
  snippets: Array<{ url: string; title: string | null; snippet: string }>;
  summaryText: string;
};

export async function loadOrgCrawlContext(
  organisationId: string,
): Promise<OrgCrawlContext> {
  const supabase = createServiceClient();

  const [{ data: org }, { data: config }, { count }] = await Promise.all([
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
  ]);

  const organisationName = org?.name?.trim() || "Organisation";
  const websiteUrl = config?.website_url?.trim() || null;
  const pageCount = count ?? 0;

  const queries = [
    organisationName,
    "Über uns Leistungen Angebot Team",
    "Kontakt Standort Region",
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
      if (snippets.length >= 10) break;
    }
    if (snippets.length >= 10) break;
  }

  const summaryText = [
    `Organisation: ${organisationName}`,
    websiteUrl ? `Website: ${websiteUrl}` : "Website: (noch nicht hinterlegt)",
    `Crawl-Seiten: ${pageCount}`,
    "",
    ...snippets.map(
      (s, i) =>
        `[${i + 1}] ${s.title || s.url}\nURL: ${s.url}\n${s.snippet}`,
    ),
  ].join("\n");

  return {
    organisationId,
    organisationName,
    websiteUrl,
    pageCount,
    snippets,
    summaryText,
  };
}

export type PrefillDraft = {
  value: string;
  source: "organisation" | "website" | "crawl";
  note: string;
};

/**
 * Conservative prefill from org config + crawl snippets.
 * Only fills when confidence is high; UI can still edit/delete.
 */
export function suggestPrefillsFromCrawl(input: {
  context: OrgCrawlContext;
  hints: Array<{ key: string; hint?: CoreQuestionPrefillHint }>;
}): Record<string, PrefillDraft> {
  const out: Record<string, PrefillDraft> = {};
  const blob = input.context.summaryText.toLowerCase();

  for (const item of input.hints) {
    if (!item.hint) continue;
    if (item.hint === "org_name" && input.context.organisationName) {
      out[item.key] = {
        value: input.context.organisationName,
        source: "organisation",
        note: "Aus Organisationsname übernommen",
      };
      continue;
    }
    if (item.hint === "website" && input.context.websiteUrl) {
      out[item.key] = {
        value: input.context.websiteUrl,
        source: "website",
        note: "Aus SEO-/Org-Konfiguration übernommen",
      };
      continue;
    }
    if (item.hint === "employee_count") {
      const m = blob.match(
        /(\d{1,4})\s*(?:mitarbeiter|beschäftigte|personen|teammitglieder|angestellte)/i,
      );
      if (m?.[1]) {
        out[item.key] = {
          value: `${m[1]} Personen (aus Website-Crawl, bitte prüfen)`,
          source: "crawl",
          note: "Aus Crawl-Text geschätzt — bitte prüfen/korrigieren",
        };
      }
    }
  }

  return out;
}
