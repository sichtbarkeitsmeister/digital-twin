import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hydrateDtHistoryForAnthropic,
  type DtDbAttachmentRow,
  type DtDbMessageRow,
} from "@/lib/dt/chat-history-anthropic";
import { loadDtSitePagesForPrompt } from "@/lib/dt/seo/build-seo-context";
import {
  formatDtSeoMonthlyStatsForPrompt,
  loadDtSeoMonthlyStats,
} from "@/lib/dt/seo/monthly-stats";
import {
  formatDtSeoReportForPrompt,
  loadLatestDtSeoReportForPrompt,
} from "@/lib/dt/seo/report-prompt-context";
import {
  formatDtSeoTasksForPrompt,
  loadDtSeoTasksForPrompt,
} from "@/lib/dt/seo/task-context";
import { buildPastedUrlContextText } from "@/lib/shared/pasted-url-context";
import { buildDtSystemPrompt } from "@/lib/dt/prompts/build-system-prompt";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtChatMode, DtMessageRow } from "@/lib/dt/types";

const HISTORY_LIMIT = 40;

export type DtAssembledChat = {
  system: string;
  messages: Anthropic.MessageParam[];
  model: string;
  mode: DtChatMode;
};

export async function assertUserInOrganisation(userId: string, organisationId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.role !== "admin") {
      throw new Error("Kein Zugriff auf diese Organisation.");
    }
  }
}

async function loadAuthorLabels(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const supabase = createServiceClient();
  const { data } = await supabase.from("profiles").select("id,email").in("id", userIds);
  for (const row of data ?? []) {
    const email = row.email?.trim() ?? "";
    const label = email.includes("@") ? email.split("@")[0] : email || "Nutzer";
    map.set(row.id, label);
  }
  return map;
}

function prefixTeamMessages(rows: DtMessageRow[], mode: DtChatMode, labels: Map<string, string>) {
  if (mode !== "team") return rows;
  return rows.map((m) => {
    if (m.role !== "user" || !m.author_user_id) return m;
    const name = labels.get(m.author_user_id) ?? "Nutzer";
    return { ...m, content: `[${name}]: ${m.content}` };
  });
}

async function loadAttachmentsMap(
  supabase: SupabaseClient,
  chatId: string,
  messageIds: string[],
): Promise<Map<string, DtDbAttachmentRow[]>> {
  const map = new Map<string, DtDbAttachmentRow[]>();
  if (messageIds.length === 0) return map;

  const { data } = await supabase
    .from("dt_chat_attachments")
    .select("message_id,storage_path,mime_type,file_name")
    .eq("chat_id", chatId)
    .in("message_id", messageIds);

  for (const row of data ?? []) {
    if (!row.message_id) continue;
    const list = map.get(row.message_id) ?? [];
    list.push(row as DtDbAttachmentRow);
    map.set(row.message_id, list);
  }
  return map;
}

export async function assembleDtChatFromDb(input: {
  chatId: string;
  userId: string;
  ghostMode?: boolean;
  supabase?: SupabaseClient;
}): Promise<DtAssembledChat> {
  const supabase = input.supabase ?? createServiceClient();

  const { data: chat, error: chatError } = await supabase
    .from("dt_chats")
    .select("id,organisation_id,agent_id,mode,title,owner_user_id")
    .eq("id", input.chatId)
    .maybeSingle();

  if (chatError || !chat) throw new Error("Chat nicht gefunden.");

  await assertUserInOrganisation(input.userId, chat.organisation_id);

  const { data: agent } = await supabase
    .from("dt_agents")
    .select("id,name,role,kind,prompt_template")
    .eq("id", chat.agent_id)
    .maybeSingle();

  if (!agent) throw new Error("Agent nicht gefunden.");

  const { data: orgConfig } = await supabase
    .from("dt_org_config")
    .select("display_name,website_url,focus_keyword,seo_checklist,sitemap_url")
    .eq("organisation_id", chat.organisation_id)
    .maybeSingle();

  const { data: prefs } = await supabase
    .from("dt_user_preferences")
    .select("global_assistant_rules")
    .eq("user_id", input.userId)
    .maybeSingle();

  const { data: messageRows } = await supabase
    .from("dt_chat_messages")
    .select("id,chat_id,role,content,metadata,author_user_id,stopped,created_at")
    .eq("chat_id", input.chatId)
    .order("created_at", { ascending: true });

  const history = ((messageRows ?? []) as DtMessageRow[]).slice(-HISTORY_LIMIT);
  const authorIds = history
    .filter((m) => m.role === "user" && m.author_user_id)
    .map((m) => m.author_user_id as string);
  const authorLabels = await loadAuthorLabels([...new Set(authorIds)]);
  const prefixed = prefixTeamMessages(history, chat.mode as DtChatMode, authorLabels);

  const attachMap = await loadAttachmentsMap(
    supabase,
    input.chatId,
    prefixed.map((m) => m.id),
  );

  const dbRows: DtDbMessageRow[] = prefixed.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata,
  }));

  const mode = chat.mode as DtChatMode;
  const promptMode = mode === "ghost" ? "default" : mode;
  const sitePages =
    promptMode === "seo"
      ? await loadDtSitePagesForPrompt(supabase, chat.organisation_id)
      : [];
  const monthlyStatsRows =
    promptMode === "seo"
      ? await loadDtSeoMonthlyStats(supabase, chat.organisation_id, 12)
      : [];
  const latestSeoReport =
    promptMode === "seo"
      ? await loadLatestDtSeoReportForPrompt(supabase, chat.organisation_id)
      : null;
  const seoTaskRows =
    promptMode === "seo"
      ? await loadDtSeoTasksForPrompt(supabase, chat.organisation_id)
      : [];

  const lastUserMessage = [...prefixed].reverse().find((m) => m.role === "user");
  const pastedUrlsText =
    promptMode === "seo" && lastUserMessage?.content
      ? ((await buildPastedUrlContextText(lastUserMessage.content)) ?? undefined)
      : undefined;

  const system = buildDtSystemPrompt({
    agent: {
      name: agent.name,
      role: agent.role,
      prompt_template: agent.prompt_template?.trim() || "Du bist ein hilfreicher Assistent.",
      kind: agent.kind,
    },
    org: {
      display_name: orgConfig?.display_name ?? agent.name,
      website_url: orgConfig?.website_url,
      focus_keyword: orgConfig?.focus_keyword,
      seo_checklist: orgConfig?.seo_checklist,
      sitemap_url: orgConfig?.sitemap_url,
    },
    mode: promptMode,
    globalRules: prefs?.global_assistant_rules,
    ghostMode: input.ghostMode ?? mode === "ghost",
    sitePages,
    latestSeoReportText:
      promptMode === "seo" ? formatDtSeoReportForPrompt(latestSeoReport) : undefined,
    monthlyStatsText:
      promptMode === "seo"
        ? formatDtSeoMonthlyStatsForPrompt(monthlyStatsRows)
        : undefined,
    seoTasksText:
      promptMode === "seo" ? formatDtSeoTasksForPrompt(seoTaskRows) : undefined,
    pastedUrlsText,
  });

  const messages = await hydrateDtHistoryForAnthropic({
    supabase,
    messages: dbRows,
    attachmentsByMessageId: attachMap,
  });

  return {
    system,
    messages,
    model: resolveDtAnthropicModel(mode),
    mode,
  };
}

/** Ghost / ephemeral: build from client-held history (no DB messages). */
export async function assembleDtChatEphemeral(input: {
  userId: string;
  organisationId: string;
  agentId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<DtAssembledChat> {
  await assertUserInOrganisation(input.userId, input.organisationId);
  const supabase = createServiceClient();

  const { data: agent } = await supabase
    .from("dt_agents")
    .select("id,name,role,kind,prompt_template")
    .eq("id", input.agentId)
    .maybeSingle();
  if (!agent) throw new Error("Agent nicht gefunden.");

  const { data: orgConfig } = await supabase
    .from("dt_org_config")
    .select("display_name,website_url,focus_keyword,seo_checklist,sitemap_url")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();

  const { data: prefs } = await supabase
    .from("dt_user_preferences")
    .select("global_assistant_rules")
    .eq("user_id", input.userId)
    .maybeSingle();

  const system = buildDtSystemPrompt({
    agent: {
      name: agent.name,
      role: agent.role,
      prompt_template: agent.prompt_template?.trim() || "Du bist ein hilfreicher Assistent.",
      kind: agent.kind,
    },
    org: {
      display_name: orgConfig?.display_name ?? agent.name,
      website_url: orgConfig?.website_url,
      focus_keyword: orgConfig?.focus_keyword,
      seo_checklist: orgConfig?.seo_checklist,
      sitemap_url: orgConfig?.sitemap_url,
    },
    mode: "default",
    globalRules: prefs?.global_assistant_rules,
    ghostMode: true,
  });

  const messages: Anthropic.MessageParam[] = input.history
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }));

  return {
    system,
    messages,
    model: resolveDtAnthropicModel("ghost"),
    mode: "ghost",
  };
}

/** Back-compat alias */
export const assembleDtChatPrompt = assembleDtChatFromDb;
