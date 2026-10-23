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
  /** Survey lineage for Persona-Testing exam questions (optional in list queries). */
  source_survey_id?: string | null;
  source_survey_response_id?: string | null;
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
  /** @deprecated Hub lives in dt_grounding_pages (kind = hub); kept for legacy reads. */
  grounding_page_url?: string | null;
  grounding_page_uploaded_at?: string | null;
  grounding_page_notes?: string | null;
  /** Optional override URL for llms.txt (domain-level, not per page). */
  grounding_llms_txt_url?: string | null;
};

export type DtGroundingPageKind = "hub" | "entity";
export type DtGroundingReviewStatus = "draft" | "approved";

/** One Grounding Page (Hub or Entitätsseite) — Grounding Page Standard v1.7 facts. */
export type DtGroundingPageRow = {
  id: string;
  organisation_id: string;
  kind: DtGroundingPageKind;
  url: string;
  entity_name: string | null;
  slug: string | null;
  standard_version: string | null;
  review_status: DtGroundingReviewStatus;
  uploaded_at: string | null;
  date_modified: string | null;
  last_reviewed: string | null;
  reviewed_by: string | null;
  notes: string | null;
  position: number;
  /** Entwurf des Grounding-Agenten (Migration 20261013_dt_grounding_drafts.sql). */
  run_state: DtGroundingRunState;
  run_step: number | null;
  run_error: string | null;
  job_id: string | null;
  facts: unknown | null;
  questions: unknown;
  findings: unknown;
  run_notes: unknown;
  html: string | null;
  title: string | null;
  meta_description: string | null;
  entity_type: string | null;
  cost_eur: number | string;
  started_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DtGroundingRunState = "nicht_begonnen" | "laeuft" | "in_arbeit" | "braucht_sie" | "fertig";

/** Grounding check („Website prüfen“), migration 20261023_dt_grounding_runs.sql. */
export type DtGroundingRunTrigger = "manual" | "schedule";
export type DtGroundingRunStatus = "running" | "up_to_date" | "draft" | "approved" | "rejected" | "uploaded" | "failed";
export type DtGroundingRunStep = "crawl" | "extract" | "compare" | "generate" | "done";
export type DtGroundingRunDecision = "create" | "update_required" | "refresh_only" | "up_to_date";

export type DtGroundingRunRow = {
  id: string;
  organisation_id: string;
  trigger: DtGroundingRunTrigger;
  status: DtGroundingRunStatus;
  step: DtGroundingRunStep;
  decision: DtGroundingRunDecision | null;
  grounding_url_checked: string | null;
  llms_txt_url_checked: string | null;
  crawled_urls: unknown;
  crawl_snapshot: unknown | null;
  fact_model: unknown | null;
  existing_fact_model: unknown | null;
  diff: unknown | null;
  open_points: unknown;
  hints: unknown | null;
  validation: unknown | null;
  draft_html: string | null;
  draft_llms_txt: string | null;
  standard_version: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number | string;
  job_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_checklist: unknown | null;
  reviewer_name: string | null;
  review_note: string | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  uploaded_url: string | null;
};

export type DtGroundingStepRow = {
  id: string;
  page_id: string;
  organisation_id: string;
  step: number;
  name: string;
  status: "pending" | "running" | "waiting" | "done" | "error" | "skipped";
  output: unknown;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_eur: number | string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
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
  /** manual | monthly_scheduler | null (legacy) */
  trigger_source?: string | null;
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
