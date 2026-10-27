/**
 * Shapes exchanged between the Texte tab and `/api/dt/content/*` (snake_case).
 * The pipeline behind the routes runs inside DigitalTwin (`lib/dt/content/pipeline`).
 */

import type { ContentModelSource, ContentModelTier } from "@/lib/dt/content/model-config";
import type { ContentTextSettings } from "@/lib/dt/content/mapping";
import type { ContentPageRole, ContentPageType } from "@/lib/dt/content/page-types";
import type { ContentSkippableStepKey, ContentStepKey } from "@/lib/dt/content/pipeline/steps";
import type { ContentTypePrompts } from "@/lib/dt/content/type-prompts";

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
  /** Which writing variant the SEO step uses; null for rows from before the briefing migration. */
  page_type: ContentPageType | null;
  page_role: ContentPageRole | null;
  /**
   * Whether the table and the drawer offer the Seitentyp select. Always true: the Excel type
   * and the crawl guess are suggestions the editor overrides (`canEditContentPageType`).
   * A running page still disables the select until it is stopped.
   */
  type_editable: boolean;
  /** How many steps the editor switched off for this page (`skip_steps`); the table notes „N übersprungen“. */
  skipped_count: number;
  /** Real Google questions from the Excel (Spalte H). */
  user_questions: number;
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
  /**
   * „fact“, „decision“, „missing“ (Faktencheck, placeholder gaps) or „outdated“ (the
   * Aktualitätsprüfung found a customer fact that may no longer be true).
   */
  kind: string;
  question: string;
  field?: string | null;
  /** Faktencheck: an example answer. A gap found in the text: the placeholder itself. */
  placeholder?: string | null;
  block_id?: string | null;
  /** Name of the Abschnitt (its heading, else its id); set when the page stops for the question. */
  section?: string | null;
  excerpt?: string | null;
  blocking: boolean;
};

/** A web source the Aktualitätsprüfung used. Internal: never part of the page text or an export. */
export type ContentFreshnessSource = { url: string; title: string | null };

/** One public fact the Aktualitätsprüfung corrected in the text. */
export type ContentFreshnessUpdate = {
  block_id: string;
  /** Name of the Abschnitt when the check ran (its heading, else its id). */
  section: string;
  old_text: string;
  new_text: string;
  reason: string;
  source_url: string;
  source_title: string | null;
  /** ISO time of the check. */
  at: string;
};

/** A whole Abschnitt the Aktualitätsprüfung found outdated: the problem, a proposal, the sources. */
export type ContentFreshnessSection = {
  block_id: string | null;
  section: string;
  problem: string;
  suggestion: string;
  sources: ContentFreshnessSource[];
};

/**
 * `dt_content_pages.freshness`: what the Aktualitätsprüfung did on this page, kept across
 * its one send-back to GEO. Cleared by „Zurücksetzen“ and by „Mit Anmerkung wiederholen“
 * from GEO or earlier.
 */
export type ContentFreshness = {
  /** How often the text went back to GEO (0 or 1); a second outdated finding becomes an open point. */
  sendbacks: number;
  updates: ContentFreshnessUpdate[];
  /** Waiting for GEO („## Aktualitätsprüfung – bitte umsetzen“); emptied when GEO finishes. */
  pending_sections: ContentFreshnessSection[];
  /** What went back to GEO the one time (for the drawer). */
  sent_back_sections: ContentFreshnessSection[];
  /** Still outdated after the send-back: listed as open points instead. */
  converted_sections: ContentFreshnessSection[];
  /** Customer questions of the first check; asked after the second one, since GEO rewrites in between. */
  carried_questions: ContentQuestion[];
};

/** What the drawer shows under „Aktualität“. */
export type ContentReviewFreshness = Omit<ContentFreshness, "carried_questions">;

export type ContentStepStatus = "done" | "running" | "waiting" | "pending" | "error" | "skipped";

export type ContentStep = {
  step: number;
  /** Stable key (`skip_steps` stores these). */
  key: ContentStepKey;
  name: string;
  status: ContentStepStatus | string;
  exists: boolean;
  cost_eur: number;
  /** The editor may switch this step off for this page (never Analyse and Endabnahme; SEO only on crawl pages). */
  skippable: boolean;
  /** Why the switch is locked („Läuft immer …“, „Nur bei Seiten von der Website …“); null when it is not. */
  reason_locked: string | null;
  /** The step is on the page's `skip_steps`: the switch shows it off. Not the row status (migration 20261027 also wrote „skipped“). */
  skipped_by_user: boolean;
  /** Skipped SEO on a crawl page: the live text became the starting text („Übersprungen – Live-Text übernommen“). */
  live_text: boolean;
};

export type ContentActionKind =
  | "approve"
  | "edit"
  | "rerun_with_note"
  | "run_through"
  | "export"
  | "export_txt"
  | "stop"
  | "reset"
  | "delete";

export type ContentAction = {
  kind: ContentActionKind;
  step?: number;
  label: string;
  /** Shown but not usable, with this reason (a rerun from a step the editor switched off). */
  disabled_reason?: string;
};

/** What the Excel briefing (or the crawl guess) knows about a page; shown compactly in the drawer. */
export type ContentPageBriefing = {
  source: ContentPageSource;
  /** The briefing comes from an Excel: structure pages, and crawl pages matched by a Seitenstruktur in „Verbesserung“. */
  from_excel: boolean;
  page_type: ContentPageType | null;
  /**
   * The editor may always change the type (Excel briefing and crawl guess are suggestions).
   * A running page disables the select until it is stopped.
   */
  type_editable: boolean;
  page_role: ContentPageRole | null;
  pillar_name: string | null;
  main_keyword: string | null;
  /** Monthly search volume of the main keyword when the Excel had one. */
  main_keyword_volume: number | null;
  secondary_keywords: string[];
  h1_options: string[];
  user_questions: string[];
  ki_prompt: string | null;
  internal_link_targets: string[];
  estimated_traffic: number | null;
};

export type ContentReview = {
  name: string;
  briefing: ContentPageBriefing;
  /**
   * The page was started with the previous step order (Recherche, Gliederung, Rohtext …).
   * Its outputs do not fit today's steps: the editor resets it.
   */
  legacy_steps: boolean;
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
  /** Updates with their sources and the send-back to GEO; the sources stay in the app, never in an export. */
  freshness: ContentReviewFreshness;
  /** Steps the editor switched off for this page, in step order. */
  skip_steps: ContentSkippableStepKey[];
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

export type ContentExportFormat = "html" | "fragment" | "md" | "txt";

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

/** Where the Seitenstruktur was uploaded: „Neue Website“ (structure) or „Verbesserung“ (crawl). */
export type ContentStructureMode = ContentPageSource;

/** One page of the Seitenstruktur that the website does not have yet („Verbesserung“). */
export type ContentStructurePlanPage = {
  slug: string;
  name: string;
  path: string | null;
  page_type: ContentPageType;
  page_type_label: string;
};

/**
 * `GET /api/dt/content/structure`: the Seitenstruktur next to the crawl („Verbesserung“).
 * `missing` are the pages neither the table nor the crawled site has; without a crawl, the
 * pages that are not in the table.
 */
export type ContentStructurePlanResult = {
  structure: {
    filename: string | null;
    uploaded_at: string | null;
    pages: number;
    /** Which mode the file was uploaded in; null for a structure from SEO → Struktur or before the migration. */
    mode: ContentStructureMode | null;
  } | null;
  /** Whether a crawl of the live site exists to compare with. */
  crawled: boolean;
  /** Structure pages that are rows of the table. */
  matched: number;
  /** Structure pages on the crawled site that are not in the table yet („Seiten übernehmen“ brings them). */
  on_site: number;
  missing: ContentStructurePlanPage[];
  /** False while the database lacks `dt_website_structures.content_briefing` (migration). */
  supported: boolean;
};

/** `POST /api/dt/content/structure/missing`: „Diese Seiten anlegen“. */
export type ContentStructureCreateResult = {
  created: number;
  plan: ContentStructurePlanResult;
  overview: ContentOverview;
};

/** `POST /api/dt/content/structure`: the Excel briefing (or a structure text) became page rows. */
export type ContentStructureUploadResult = {
  mode: ContentStructureMode;
  /** „Verbesserung“: rows of the table that took the Excel briefing (no row is created). */
  updated: number;
  /** „Verbesserung“: the comparison with the crawl after the upload; null for „Neue Website“. */
  plan: ContentStructurePlanResult | null;
  filename: string | null;
  /** Which layout was read: the old briefing (A–H), the DT template (Ebene 1 … n) or a plain structure text. */
  layout: "briefing" | "template" | "text";
  sheet: string | null;
  pages: number;
  /** How many pages carry keywords, real user questions, H1 options; how many are „nicht bearbeiten“. */
  keywords: number;
  questions: number;
  h1_options: number;
  skipped: number;
  /** Whether SEO → Struktur received the same pages as an outline. */
  seo_synced: boolean;
  overview: ContentOverview;
};

/**
 * `POST /api/dt/content/reset-all`: Texte of one organisation back to an empty start — pages
 * with steps, questions and cost, open jobs, the confirmed settings and the uploaded
 * Seitenstruktur. Crawl data, avatars and Anbieterfakten are not touched.
 */
export type ContentToolResetResult = {
  pages: number;
  steps: number;
  /** Open content jobs that were ended. */
  jobs: number;
  settings: boolean;
  structure: boolean;
  overview: ContentOverview;
};

/** `GET` / `PUT /api/dt/content/type-prompts`: the agency's writing recipes per page type. */
export type ContentTypePromptsResult = {
  prompts: ContentTypePrompts;
  defaults: ContentTypePrompts;
  storage: "db" | "defaults" | "missing_table" | "missing_columns" | "missing_hauptseite";
  updated_at: string | null;
  updated_by_email: string | null;
  /** Set when the table is missing: which migration to run. */
  hint: string | null;
};

/** `PATCH /api/dt/content/pages/[slug]`: the editor changed the page type or the steps switched off. */
export type ContentPagePatchResult = { review: ContentReview; overview: ContentOverview };

/** `POST /api/dt/content/crawl/import` */
export type ContentCrawlImportResult = {
  imported: number;
  attached: number;
  /** Rows that took the briefing of a Seitenstruktur uploaded in „Verbesserung“. */
  briefed: number;
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
