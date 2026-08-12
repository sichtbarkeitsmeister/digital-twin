import {
  parseSeoReportPayload,
  reportStateLabel,
  resolveOwnerDeliveryStatus,
} from "@/lib/dt/seo/report-payload";
import { filterUsageEventsForOrgMembers } from "@/lib/dt/agents/seo-advisor";
import {
  computeSeoStatsSummary,
  loadDtSeoMonthlyStats,
} from "@/lib/dt/seo/monthly-stats";
import { createServiceClient } from "@/lib/supabase/service";

export type OrgOverviewAgent = {
  id: string;
  name: string;
  kind: string;
  isEnabled: boolean;
  isDefault: boolean;
  position: number;
};

export type OrgOverviewSeoReport = {
  id: string;
  state: string;
  stateLabel: string;
  stateMessage: string | null;
  finishedAt: string | null;
  createdAt: string;
  actionCount: number;
  ownerDelivery: ReturnType<typeof resolveOwnerDeliveryStatus>;
};

export type OrgOverviewSeoTasks = {
  open: number;
  inProgress: number;
  done: number;
  wontFix: number;
  total: number;
};

export type OrgOverviewSeoMonthly = {
  periodMonth: string | null;
  aiClicks: number | null;
  totalClicks: number | null;
  impressions: number | null;
  rankingsTop10: number | null;
  visibilityIndex: number | null;
  aiClicksMomPct: number | null;
  chart: Array<{
    periodMonth: string;
    label: string;
    aiClicks: number;
    totalClicks: number;
    rankingsTop10: number;
  }>;
};

export type OrgOverviewCrawl = {
  status: string;
  pagesCrawled: number;
  finishedAt: string | null;
};

export type OrgOverviewUsage = {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerMessage: number;
  topAgent: { id: string; name: string; totalTokens: number } | null;
  topUser: { id: string; email: string | null; totalTokens: number } | null;
  byDay: Array<{
    date: string;
    messages: number;
    totalTokens: number;
  }>;
};

export type OrgOverviewConfig = {
  displayName: string | null;
  seoEnabled: boolean;
  disabled: boolean;
  websiteUrl: string | null;
  focusKeyword: string | null;
  reportRecipientEmail: string | null;
  ga4Connected: boolean;
  gscConnected: boolean;
};

export type OrgOverview = {
  config: OrgOverviewConfig;
  agents: OrgOverviewAgent[];
  agentTotal: number;
  agentEnabled: number;
  seoReport: OrgOverviewSeoReport | null;
  seoTasks: OrgOverviewSeoTasks;
  seoMonthly: OrgOverviewSeoMonthly;
  lastCrawl: OrgOverviewCrawl | null;
  chatCount: number;
  usage: OrgOverviewUsage | null;
};

function emptySeoTasks(): OrgOverviewSeoTasks {
  return { open: 0, inProgress: 0, done: 0, wontFix: 0, total: 0 };
}

function emptySeoMonthly(): OrgOverviewSeoMonthly {
  return {
    periodMonth: null,
    aiClicks: null,
    totalClicks: null,
    impressions: null,
    rankingsTop10: null,
    visibilityIndex: null,
    aiClicksMomPct: null,
    chart: [],
  };
}

function aggregateUsage(
  rows: Array<{
    user_id: string | null;
    agent_id: string | null;
    mode?: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    created_at: string;
  }>,
  agentNames: Map<string, string>,
  userEmails: Map<string, string | null>,
): OrgOverviewUsage {
  let totalInput = 0;
  let totalOutput = 0;
  const byUser = new Map<string, { input: number; output: number }>();
  const byAgent = new Map<string, { input: number; output: number }>();
  const byDay = new Map<string, { messages: number; input: number; output: number }>();

  for (const row of rows) {
    const input = row.input_tokens ?? 0;
    const output = row.output_tokens ?? 0;
    totalInput += input;
    totalOutput += output;

    const dayKey = row.created_at.slice(0, 10);
    const day = byDay.get(dayKey) ?? { messages: 0, input: 0, output: 0 };
    day.messages += 1;
    day.input += input;
    day.output += output;
    byDay.set(dayKey, day);

    if (row.user_id) {
      const u = byUser.get(row.user_id) ?? { input: 0, output: 0 };
      u.input += input;
      u.output += output;
      byUser.set(row.user_id, u);
    }

    if (row.agent_id) {
      const a = byAgent.get(row.agent_id) ?? { input: 0, output: 0 };
      a.input += input;
      a.output += output;
      byAgent.set(row.agent_id, a);
    }
  }

  const totalTokens = totalInput + totalOutput;
  const messages = rows.length;

  let topAgent: OrgOverviewUsage["topAgent"] = null;
  for (const [agentId, totals] of byAgent) {
    const tokens = totals.input + totals.output;
    if (!topAgent || tokens > topAgent.totalTokens) {
      topAgent = {
        id: agentId,
        name: agentNames.get(agentId) ?? agentId,
        totalTokens: tokens,
      };
    }
  }

  let topUser: OrgOverviewUsage["topUser"] = null;
  for (const [userId, totals] of byUser) {
    const tokens = totals.input + totals.output;
    if (!topUser || tokens > topUser.totalTokens) {
      topUser = {
        id: userId,
        email: userEmails.get(userId) ?? null,
        totalTokens: tokens,
      };
    }
  }

  return {
    messages,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    totalTokens,
    avgTokensPerMessage: messages > 0 ? Math.round(totalTokens / messages) : 0,
    topAgent,
    topUser,
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        messages: d.messages,
        totalTokens: d.input + d.output,
      })),
  };
}

export async function loadOrgOverview(
  organisationId: string,
  options: { includeUsage?: boolean; excludeSeoUsage?: boolean } = {},
): Promise<OrgOverview> {
  const supabase = createServiceClient();
  const includeUsage = options.includeUsage ?? false;
  const excludeSeoUsage = options.excludeSeoUsage ?? false;
  const usageSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    configRes,
    agentsRes,
    reportRes,
    tasksRes,
    monthlyStats,
    crawlRes,
    chatsRes,
    usageRes,
  ] = await Promise.all([
    supabase
      .from("dt_org_config")
      .select(
        "display_name,seo_enabled,disabled,website_url,focus_keyword,report_recipient_email,ga4_property_id,gsc_site_url",
      )
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    supabase
      .from("dt_agents")
      .select("id,name,slug,kind,is_enabled,is_default,position")
      .eq("organisation_id", organisationId)
      .order("position", { ascending: true }),
    supabase
      .from("dt_seo_reports")
      .select(
        "id,state,state_message,finished_at,created_at,recipient_type,send_to_owner,owner_sent_at,payload",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dt_seo_tasks")
      .select("status")
      .eq("organisation_id", organisationId),
    loadDtSeoMonthlyStats(supabase, organisationId, 12),
    supabase
      .from("dt_site_crawls")
      .select("status,pages_crawled,finished_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dt_chats")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId),
    includeUsage
      ? supabase
          .from("dt_llm_usage_events")
          .select("user_id,agent_id,mode,input_tokens,output_tokens,created_at")
          .eq("organisation_id", organisationId)
          .gte("created_at", usageSince)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  const cfg = configRes.data;
  const config: OrgOverviewConfig = {
    displayName: cfg?.display_name ?? null,
    seoEnabled: cfg?.seo_enabled ?? false,
    disabled: cfg?.disabled ?? false,
    websiteUrl: cfg?.website_url ?? null,
    focusKeyword: cfg?.focus_keyword ?? null,
    reportRecipientEmail: cfg?.report_recipient_email ?? null,
    ga4Connected: Boolean(cfg?.ga4_property_id?.trim()),
    gscConnected: Boolean(cfg?.gsc_site_url?.trim()),
  };

  const agents: OrgOverviewAgent[] = (agentsRes.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    isEnabled: a.is_enabled,
    isDefault: a.is_default ?? false,
    position: a.position,
  }));
  const agentEnabled = agents.filter((a) => a.isEnabled).length;

  let seoReport: OrgOverviewSeoReport | null = null;
  if (reportRes.data) {
    const r = reportRes.data;
    const parsed = parseSeoReportPayload(r.payload);
    seoReport = {
      id: r.id,
      state: r.state,
      stateLabel: reportStateLabel(r.state),
      stateMessage: (r as { state_message?: string | null }).state_message ?? null,
      finishedAt: r.finished_at,
      createdAt: r.created_at,
      actionCount: parsed.recommendations.length,
      ownerDelivery: resolveOwnerDeliveryStatus(r),
    };
  }

  const seoTasks = emptySeoTasks();
  for (const task of tasksRes.data ?? []) {
    seoTasks.total += 1;
    switch (task.status) {
      case "open":
        seoTasks.open += 1;
        break;
      case "in_progress":
        seoTasks.inProgress += 1;
        break;
      case "done":
        seoTasks.done += 1;
        break;
      case "wont_fix":
        seoTasks.wontFix += 1;
        break;
      default:
        break;
    }
  }

  const monthlySummary = computeSeoStatsSummary(monthlyStats);
  const seoMonthly: OrgOverviewSeoMonthly = monthlySummary.latest
    ? {
        periodMonth: monthlySummary.latest.period_month,
        aiClicks: monthlySummary.latest.ai_clicks,
        totalClicks: monthlySummary.latest.total_clicks,
        impressions: monthlySummary.latest.impressions,
        rankingsTop10: monthlySummary.latest.rankings_top10,
        visibilityIndex: monthlySummary.latest.visibility_index,
        aiClicksMomPct: monthlySummary.aiClicksMomPct,
        chart: monthlySummary.chart,
      }
    : emptySeoMonthly();

  const crawl = crawlRes.data;
  const lastCrawl: OrgOverviewCrawl | null = crawl
    ? {
        status: crawl.status,
        pagesCrawled: crawl.pages_crawled,
        finishedAt: crawl.finished_at,
      }
    : null;

  let usage: OrgOverviewUsage | null = null;
  if (includeUsage && usageRes.data) {
    const agentsById = new Map(
      (agentsRes.data ?? []).map((agent) => [
        agent.id,
        { slug: agent.slug, kind: agent.kind },
      ]),
    );
    const rows = excludeSeoUsage
      ? filterUsageEventsForOrgMembers(usageRes.data, agentsById)
      : usageRes.data;
    const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))] as string[];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];

    const [{ data: agentRows }, { data: profileRows }] = await Promise.all([
      agentIds.length
        ? supabase.from("dt_agents").select("id,name").in("id", agentIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from("profiles").select("id,email").in("id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    const agentNames = new Map((agentRows ?? []).map((a) => [a.id, a.name]));
    const userEmails = new Map((profileRows ?? []).map((p) => [p.id, p.email]));
    usage = aggregateUsage(rows, agentNames, userEmails);
  }

  return {
    config,
    agents,
    agentTotal: agents.length,
    agentEnabled,
    seoReport,
    seoTasks,
    seoMonthly,
    lastCrawl,
    chatCount: chatsRes.count ?? 0,
    usage,
  };
}
