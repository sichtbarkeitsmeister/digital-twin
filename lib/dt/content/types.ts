/**
 * Shapes exchanged between the Texte tab and `/api/dt/content/*` (snake_case).
 * The pipeline behind the routes runs inside DigitalTwin (`lib/dt/content/pipeline`).
 */

import type { ContentModelSource, ContentModelTier } from "@/lib/dt/content/model-config";
import type { ContentTextSettings } from "@/lib/dt/content/mapping";

export type ContentPageState =
  | "nicht_begonnen"
  | "laeuft"
  | "in_arbeit"
  | "braucht_sie"
  | "fertig";

/** Where a page row came from: the uploaded Seitenstruktur or the crawl of the live site. */
export type ContentPageSource = "structure" | "crawl";

export type ContentReadinessCheckId = "anbieter" | "avatar" | "structure";

export type ContentReadinessCheck = {
  id: ContentReadinessCheckId;
  ok: boolean;
  label: string;
  hint: string;
};

export type ContentReadiness = {
  ready: boolean;
  checks: ContentReadinessCheck[];
};

export type ContentPageSummary = {
  name: string;
  slug: string;
  level: number;
  path: string | null;
  source: ContentPageSource;
  /** Live URL for pages taken over from the crawl. */
  source_url: string | null;
  main_keyword: string | null;
  started: boolean;
  state: ContentPageState;
  label: string;
  detail: string | null;
  step: number | null;
  cost_eur: number;
  cost: string;
  questions: number;
  released?: boolean;
  /** Not in the agreed contract yet; the "Zuletzt" column shows "—" without it. */
  updated_at?: string | null;
};

export type ContentOverview = {
  readiness: ContentReadiness;
  pages: ContentPageSummary[];
  needs_you: number;
  finished: number;
  running: number;
  cost_eur: number;
  cost: string;
};

export type ContentClientPutBody = {
  anbieter?: Record<string, unknown>;
  avatar?: Record<string, unknown>;
};

export type ContentClientPutResult = {
  client: string;
  anbieter: boolean;
  avatar: boolean;
  /** Short description of the page source („Struktur: datei.xlsx“, „Crawl: 24 Seiten“) or null. */
  structure: string | null;
  complete: boolean;
  problems: string[];
};

export type ContentJobRef = {
  id: string;
  slug: string;
  page: string;
  state: string;
  status_url: string;
};

export type ContentRunThroughResult = {
  jobs: ContentJobRef[];
  skipped: Array<{ page: string; reason: string }>;
};

export type ContentPageRunThroughResult = {
  id: string;
  status_url: string;
};

export type ContentFinding = {
  title: string;
  problem: string;
  proposal: string;
  severity: string;
  severity_label: string;
  block_id: string | null;
};

export type ContentQuestion = {
  kind: string;
  question: string;
  field?: string | null;
  placeholder?: string | null;
  block_id?: string | null;
  excerpt?: string | null;
  blocking: boolean;
};

export type ContentStepStatus = "done" | "running" | "waiting" | "pending" | "error" | "skipped";

export type ContentStep = {
  step: number;
  name: string;
  status: ContentStepStatus | string;
  exists: boolean;
  cost_eur: number;
};

export type ContentActionKind =
  | "approve"
  | "edit"
  | "rerun_with_note"
  | "run_through"
  | "export"
  | "stop"
  | "reset"
  | "delete";

export type ContentAction = {
  kind: ContentActionKind;
  step?: number;
  label: string;
};

export type ContentReview = {
  name: string;
  public: {
    state: ContentPageState;
    label: string;
    detail: string | null;
    step: number | null;
    cost: string;
    released?: boolean;
  };
  text_step: number | null;
  markdown: string;
  html: string;
  findings: ContentFinding[];
  final_findings: ContentFinding[];
  unresolved: ContentFinding[];
  questions: ContentQuestion[];
  steps: ContentStep[];
  actions: ContentAction[];
};

export type ContentClientQuestion = ContentQuestion & {
  page: string;
  slug: string;
};

export type ContentQuestionsResult = {
  questions: ContentClientQuestion[];
};

export type ContentJob = {
  state: "running" | "done" | "error";
  result: unknown;
  error: string | null;
};

export type ContentExportFormat = "html" | "fragment" | "md";

/** What DigitalTwin itself has for the three readiness checks. */
export type ContentLocalSources = {
  /**
   * Where the facts come from: workshop sections (`dt_workshop_corpus.anbieter`) and/or the
   * completed Anbieter-Fragebogen. Null when neither has content.
   */
  anbieter: {
    workshop: { filled: number; total: number } | null;
    fragebogen: { title: string; facts: number } | null;
  } | null;
  avatarCount: number;
  /** Uploaded Seitenstruktur (Excel template / text), when the organisation has one. */
  structure: { filename: string | null; uploadedAt: string | null; nodeCount: number } | null;
  /** Crawl of the existing website: configured URL and what `dt_site_pages` holds. */
  crawl: { websiteUrl: string | null; pageCount: number; lastCrawledAt: string | null };
  /** Rows in `dt_content_pages`, split by where they came from. */
  pages: { total: number; structure: number; crawl: number };
};

/** `GET /api/dt/content/crawl`: the crawler mode of „Seiten“. */
export type ContentCrawlStatus = {
  website_url: string | null;
  crawl: {
    id: string;
    status: string;
    pages_crawled: number;
    pages_discovered: number;
    max_pages: number;
    message: string | null;
    started_at: string | null;
  } | null;
  last_crawl_error: string | null;
  /** Crawled pages of the live site that can be taken over (not excluded). */
  page_count: number;
  last_crawled_at: string | null;
  /** Pages in the Texte table that came from the crawl. */
  imported: number;
};

/** `POST /api/dt/content/reset`: selected pages back to „Nicht begonnen“ (reset) or removed (delete). */
export type ContentResetResult = {
  mode: "reset" | "delete";
  affected: number;
  skipped: Array<{ page: string; reason: string }>;
  overview: ContentOverview;
};

/** `POST /api/dt/content/crawl/import` */
export type ContentCrawlImportResult = {
  imported: number;
  attached: number;
  skipped: { excluded: number; empty: number; redirected: number; duplicate: number; over_limit: number };
  overview: ContentOverview;
};

/** Which model the pipeline will use for the next step and where that setting comes from. */
export type ContentPipelineInfo = {
  model: string;
  check_model: string;
  source: Record<ContentModelTier, ContentModelSource>;
};

export type ContentReadinessResult = {
  readiness: ContentReadiness;
  local: ContentLocalSources;
  pipeline: ContentPipelineInfo;
  /** Confirmed settings from `dt_content_settings`; null until confirmed once. */
  settings: (ContentTextSettings & { avatar_agent_id: string | null }) | null;
};

/** What `/api/dt/content/*` returns to the browser. */
export type ContentApiResponse<T> = { ok: true; data: T } | { ok: false; message: string };
