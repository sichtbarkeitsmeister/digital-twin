export type DtChatMode = "default" | "seo" | "team" | "ghost";

export type DtAgentRow = {
  id: string;
  organisation_id: string;
  slug: string;
  name: string;
  role: string | null;
  kind: string;
  quick_actions: unknown;
  is_enabled: boolean;
  position: number;
  /** Persona structured fields (disg, emoji, …) — optional in list queries. */
  avatar_data?: unknown;
};

export type DtOrgConfigRow = {
  organisation_id: string;
  display_name: string;
  twin_provisioned: boolean;
  seo_enabled: boolean;
  disabled: boolean;
  website_url?: string | null;
  footer_url?: string | null;
  ga4_property_id?: string | null;
  ga4_account?: string | null;
  gsc_site_url?: string | null;
  gsc_account?: string | null;
  sistrix_domain?: string | null;
  sitemap_url?: string | null;
  focus_keyword?: string | null;
  report_recipient_email?: string | null;
  report_timeframe?: string | null;
  seo_checklist?: unknown;
  seo_checklist_personalized?: boolean;
  videos?: unknown;
};

export type DtSeoTaskRow = {
  id: string;
  organisation_id: string;
  report_id: string | null;
  chat_id: string | null;
  message_id: string | null;
  title: string;
  url: string | null;
  keyword: string | null;
  current_status: string | null;
  action: string | null;
  assigned_to_user_id: string | null;
  assigned_to_label: string | null;
  status: "open" | "in_progress" | "done" | "wont_fix";
  priority: string | null;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DtSeoReportRow = {
  id: string;
  organisation_id: string;
  triggered_by_user_id?: string | null;
  recipient_type: string;
  recipient_email: string;
  send_to_owner?: boolean;
  owner_sent_at?: string | null;
  state: "idle" | "queued" | "running" | "done" | "error" | "cancelled";
  state_message: string | null;
  url?: string | null;
  focus_keyword?: string | null;
  timeframe?: string | null;
  ga4_property_id?: string | null;
  gsc_site_url?: string | null;
  sistrix_domain?: string | null;
  payload: Record<string, unknown>;
  pdf_path: string | null;
  followup_due_at: string | null;
  followup_done: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DtSitePageRow = {
  id: string;
  organisation_id: string;
  url: string;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  text_content?: string | null;
  is_excluded: boolean;
  crawled_at: string;
};

export type DtSeoTaskTimeEntryRow = {
  id: string;
  task_id: string;
  organisation_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  note: string | null;
  created_at: string;
};

export type DtChatRow = {
  id: string;
  organisation_id: string;
  agent_id: string;
  mode: DtChatMode;
  owner_user_id: string | null;
  title: string;
  archived_at: string | null;
  pinned: boolean;
  shared_to_team_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DtMessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  author_user_id: string | null;
  stopped: boolean;
  created_at: string;
};

export function parseQuickActions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
