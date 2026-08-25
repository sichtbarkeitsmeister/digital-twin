import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  loadDtSitePagesForPrompt,
} from "@/lib/dt/seo/build-seo-context";
import {
  loadDtSeoTasksForPrompt,
} from "@/lib/dt/seo/task-context";
import { loadOrgCrawlContext } from "@/lib/surveys/org-crawl-context";
import {
  clipWorkspaceText,
  formatOpenSeoTasksForSurveyAssistant,
  formatSitePageIndexForSurveyAssistant,
  MAX_CRAWL_SUMMARY_CHARS,
  pickFocusedOrganisationIds,
  type SurveyAssistantFocusedOrgWorkspace,
  type SurveyAssistantOrgDirectoryEntry,
  type SurveyAssistantWorkspace,
} from "@/lib/ai/survey-assistant-workspace";

type OrgRow = { id: string; name: string; slug: string | null };
type ConfigRow = {
  organisation_id: string;
  display_name: string | null;
  website_url: string | null;
};
type CrawlRow = {
  organisation_id: string;
  status: string | null;
  pages_crawled: number | null;
  finished_at: string | null;
  created_at: string;
};
type TaskCountRow = { organisation_id: string; status: string | null };

async function loadOrganisationDirectory(): Promise<SurveyAssistantOrgDirectoryEntry[]> {
  const supabase = createServiceClient();

  const [orgsRes, configsRes, crawlsRes, tasksRes] = await Promise.all([
    supabase
      .from("organisations")
      .select("id,name,slug")
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase.from("dt_org_config").select("organisation_id,display_name,website_url"),
    supabase
      .from("dt_site_crawls")
      .select("organisation_id,status,pages_crawled,finished_at,created_at")
      .order("created_at", { ascending: false })
      .limit(800),
    supabase.from("dt_seo_tasks").select("organisation_id,status"),
  ]);

  const orgs = (orgsRes.data ?? []) as OrgRow[];
  const configById = new Map<string, ConfigRow>();
  for (const row of (configsRes.data ?? []) as ConfigRow[]) {
    configById.set(row.organisation_id, row);
  }

  const lastCrawlById = new Map<string, CrawlRow>();
  for (const row of (crawlsRes.data ?? []) as CrawlRow[]) {
    if (!lastCrawlById.has(row.organisation_id)) {
      lastCrawlById.set(row.organisation_id, row);
    }
  }

  const openById = new Map<string, number>();
  const inProgressById = new Map<string, number>();
  for (const row of (tasksRes.data ?? []) as TaskCountRow[]) {
    if (row.status === "open") {
      openById.set(row.organisation_id, (openById.get(row.organisation_id) ?? 0) + 1);
    } else if (row.status === "in_progress") {
      inProgressById.set(
        row.organisation_id,
        (inProgressById.get(row.organisation_id) ?? 0) + 1,
      );
    }
  }

  return orgs.map((org) => {
    const config = configById.get(org.id);
    const crawl = lastCrawlById.get(org.id);
    const pageCount = crawl?.pages_crawled ?? 0;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      displayName: config?.display_name?.trim() || null,
      websiteUrl: config?.website_url?.trim() || null,
      crawlPageCount: pageCount,
      lastCrawlStatus: crawl?.status ?? null,
      lastCrawledAt: crawl?.finished_at ?? crawl?.created_at ?? null,
      openTaskCount: openById.get(org.id) ?? 0,
      inProgressTaskCount: inProgressById.get(org.id) ?? 0,
    };
  });
}

export async function loadFocusedOrgWorkspace(
  organisationId: string,
): Promise<SurveyAssistantFocusedOrgWorkspace | null> {
  const supabase = createServiceClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("id,name")
    .eq("id", organisationId)
    .maybeSingle();
  if (!org) return null;

  const [crawl, pages, tasks, config] = await Promise.all([
    loadOrgCrawlContext(organisationId),
    loadDtSitePagesForPrompt(supabase, organisationId, 120),
    loadDtSeoTasksForPrompt(supabase, organisationId, 80),
    supabase
      .from("dt_org_config")
      .select("website_url")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);

  return {
    organisationId,
    organisationName: crawl.organisationName || org.name,
    websiteUrl: crawl.websiteUrl || config.data?.website_url?.trim() || null,
    crawlPageCount: crawl.pageCount,
    crawlSummary: clipWorkspaceText(crawl.summaryText, MAX_CRAWL_SUMMARY_CHARS),
    sitePageIndex: formatSitePageIndexForSurveyAssistant(pages),
    openTasks: formatOpenSeoTasksForSurveyAssistant(tasks),
  };
}

export async function loadSurveyAssistantWorkspace(input: {
  pageOrganisationId?: string | null;
  surveyOrganisationId?: string | null;
  userMessage?: string;
  surveyTitle?: string | null;
  conversationSummary?: string;
}): Promise<SurveyAssistantWorkspace> {
  const organisations = await loadOrganisationDirectory();
  const focusedIds = pickFocusedOrganisationIds({
    organisations,
    pageOrganisationId: input.pageOrganisationId,
    surveyOrganisationId: input.surveyOrganisationId,
    userMessage: input.userMessage,
    surveyTitle: input.surveyTitle,
    conversationSummary: input.conversationSummary,
  });

  const focused: SurveyAssistantFocusedOrgWorkspace[] = [];
  for (const id of focusedIds) {
    try {
      const packed = await loadFocusedOrgWorkspace(id);
      if (packed) focused.push(packed);
    } catch (err) {
      console.warn("[survey-ai] loadFocusedOrgWorkspace failed", id, err);
    }
  }

  return { organisations, focused };
}
