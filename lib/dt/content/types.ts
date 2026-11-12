/**
 * Shapes exchanged between the Texte tab and `/api/dt/content/*` (snake_case).
 * The pipeline behind the routes runs inside DigitalTwin (`lib/dt/content/pipeline`).
 */

import type { ContentZielgruppen } from "@/lib/dt/content/zielgruppen";
import type { ContentPageFact } from "@/lib/dt/content/pipeline/page-facts-model";
import type { ContactFieldKey, ContactSource, OrgContactData } from "@/lib/dt/contact-data";
import type { ContentModelSource, ContentModelTier } from "@/lib/dt/content/model-config";
import type { ContentTextSettings } from "@/lib/dt/content/mapping";
import type { ContentPageRole, ContentPageType } from "@/lib/dt/content/page-types";
import type { ContentSkippableStepKey, ContentStepKey } from "@/lib/dt/content/pipeline/steps";
import type { ContentTypePrompts } from "@/lib/dt/content/type-prompts";
import type { TextUploadStatus } from "@/lib/dt/content/upload-match";

export type ContentPageState =
  | "nicht_begonnen"
  | "laeuft"
  | "in_arbeit"
  | "braucht_sie"
  | "fertig";

/**
 * Where a page row came from: the uploaded Seitenstruktur, the crawl of the live site, or a
 * Word file with the page's existing text („Verbesserung → Texte hochladen“, website not live yet).
 */
export type ContentPageSource = "structure" | "crawl" | "upload";

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
  /** Zielgruppen of the page (avatar ids); null without the migration 20261112. */
  zielgruppen: Pick<ContentZielgruppen, "primary" | "secondary" | "status"> | null;
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
  /** Stable id on the page (`contentQuestionId`); the answer fields address it. */
  id?: string;
  /**
   * „firma“: the same on every page (Telefon, Öffnungszeiten, Google-Profil …), asked once per
   * organisation under „Fragen zum Unternehmen“; „seite“: about this page. Set by the model,
   * checked in code with the topic map (a topic in the map is always „firma“).
   */
  scope?: "firma" | "seite";
  /** Topic of the code's topic map (telefon, adresse …), null for anything else. */
  topic?: string | null;
  /** How much the page needs the answer; the three most important ones are asked. */
  severity?: string;
  /** Faktencheck only, at most one: the page's main topic itself is in doubt; stops right after the Faktencheck. */
  grundlegend?: boolean;
  /** The step that raised it. */
  origin_step?: number | null;
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
  /** The editor may switch this step off for this page (never Analyse and Endabnahme; SEO only on crawl and upload pages). */
  skippable: boolean;
  /** Why the switch is locked („Läuft immer …“, „Nur bei Seiten mit vorhandenem Text …“); null when it is not. */
  reason_locked: string | null;
  /** The step is on the page's `skip_steps`: the switch shows it off. Not the row status (migration 20261027 also wrote „skipped“). */
  skipped_by_user: boolean;
  /** Skipped SEO on a crawl page: the live text became the starting text („Übersprungen – Live-Text übernommen“). */
  live_text: boolean;
  /** Skipped SEO on an upload page: the text of the Word file became the starting text. */
  upload_text: boolean;
  /** Output tokens of the step's last run (all its calls); 0 when it has not run. */
  output_tokens: number;
  /** Why the model stopped in the step's last call: `tool_use`, `end_turn`, `max_tokens`, `timeout` …; null when unknown. */
  stop_reason: string | null;
  model: string | null;
  /** The step's error, or why it is tried again; null otherwise. */
  error: string | null;
};

export type ContentActionKind =
  | "approve"
  | "edit"
  | "revise"
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
  /** „Zusätzliche Wünsche für diese Seite“, one per line (empty when none). */
  client_wishes: string;
};

export type ContentReview = {
  name: string;
  briefing: ContentPageBriefing;
  /**
   * Zielgruppen of this page (primary / secondary, suggestion or confirmed); empty lists = the
   * Standard-Zielgruppe. Null while the database has no column for them (migration 20261112).
   */
  zielgruppen: ContentZielgruppen | null;
  /**
   * The page was started with the previous step order (Recherche, Gliederung, Rohtext …).
   * Its outputs do not fit today's steps: the editor resets it.
   */
  legacy_steps: boolean;
  /**
   * The page's Faktenauszug from the customer's conversations (made before the Analyse); null
   * until it exists (page not started, or started before the excerpt was introduced).
   */
  page_facts: {
    /** „18 Fakten aus 3 Gesprächen“ */
    summary: string;
    facts: ContentPageFact[];
    /** What the page would need but no conversation says. */
    gaps: string[];
    conversations: number;
    /** The conversations were too long for one call; their wording was shortened. */
    shortened: boolean;
    error: string | null;
    /** Why no excerpt was made on purpose (evaluation not approved or outdated); null otherwise. */
    skipped: string | null;
    /** Statements the evaluation blocks („Gesperrt“), as every step gets them. */
    blocked: string[];
  } | null;
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
  /** Questions collected while the page runs; asked once, before the Watermark Entfernung. */
  collected_questions: ContentQuestion[];
  /** The page's one stop for questions (`dt_content_pages.question_stop`). */
  question_stop: {
    status: "none" | "waiting" | "answered" | "done";
    asked: number;
    /** Decisions so far: the customer's and the known answers. */
    handled: Array<{ id: string; action: "answer" | "drop"; answer: string | null; source: string; question: string }>;
    /** Cost of „Antworten einarbeiten“, once it ran. */
    pass_cost: string | null;
  };
  /** „Zur Durchsicht“ before the Watermark Entfernung: the page's switch and where the page is. */
  review_stop: {
    enabled: boolean;
    status: "none" | "waiting" | "done";
    /** The Watermark Entfernung has run: a revised Abschnitt goes through it on its own. */
    watermark_done: boolean;
  };
  /** Questions the page's notes mark as „KUNDE PRÜFT“: their placeholders show as „[KUNDE PRÜFT: …]“ in the text. */
  kunde_prueft: string[];
  /** Company questions this page raised („Fragen zum Unternehmen“; one answer for all pages). */
  org_questions: ContentOrgQuestionView[];
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
    /** `stale`: a conversation was uploaded or changed after the last evaluation; the texts do not know it yet. */
    workshop: { filled: number; total: number; stale?: boolean } | null;
    fragebogen: { title: string; facts: number } | null;
  } | null;
  avatarCount: number;
  /** Uploaded Seitenstruktur (Excel template / text), when the organisation has one. */
  structure: { filename: string | null; uploadedAt: string | null; nodeCount: number } | null;
  /** Crawl of the existing website: configured URL and what `dt_site_pages` holds. */
  crawl: { websiteUrl: string | null; pageCount: number; lastCrawledAt: string | null };
  /** Rows in `dt_content_pages`, split by where they came from. */
  pages: { total: number; structure: number; crawl: number; upload: number };
  /** Word files stored under „Texte hochladen“ (0 while the migration is missing). */
  textUploads: number;
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
export type ContentStructureMode = "structure" | "crawl";

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

/** `GET` / `PUT /api/dt/content/contact`: the organisation's Kontaktdaten (shared with the Firmenprofil). */
export type ContentContactResult = {
  contact: OrgContactData;
  /** A crawl of the website exists: „Aus Website neu füllen“ is offered (not for a new website). */
  crawl_available: boolean;
  /** Why „Google-Profil suchen“ cannot run now (no name or place, link filled, „Kein Google-Profil“); null when it can. */
  google_blocked: string | null;
};

/** `PUT /api/dt/content/contact`: the whole card; only fields whose text changed become „manuell“. */
export type ContentContactPutBody = {
  organisationId: string;
  fields: Partial<Record<ContactFieldKey, string>>;
  custom: Array<{ label: string; value: string }>;
  no_google_profile: boolean;
};

/** `POST /api/dt/content/contact/refill` and `/google`: what the fill or the search did. */
export type ContentContactActionResult = ContentContactResult & {
  /** Fields that changed, with their new source. */
  changed: Array<{ key: ContactFieldKey; source: ContactSource }>;
  message: string;
};

/** `PUT /api/dt/content/wishes`: „Kundenwünsche“ of the organisation, one per line. */
export type ContentWishesResult = { client_wishes: string; count: number };

/** One question of „Fragen zum Unternehmen“ as the browser sees it. */
export type ContentOrgQuestionView = {
  id: string;
  question: string;
  placeholder: string | null;
  status: "open" | "answered" | "no_answer";
  answer: string | null;
  /** How many pages raised it. */
  pages: number;
};

/** `GET` / `PUT /api/dt/content/org-questions`. */
export type ContentOrgQuestionsResult = {
  questions: Array<ContentOrgQuestionView & { page_slugs: string[]; topic_key: string | null; answered_at: string | null }>;
};

/** `POST /api/dt/content/pages/[slug]/answers`: answers at the page's stop (or for the one „grundlegend“ question). */
export type ContentAnswersBody = {
  organisationId: string;
  answers: Array<{ id: string; action: "answer" | "drop"; answer?: string | null }>;
  /** „Antworten einarbeiten & weiter“: every question decided, the run goes on. */
  submit?: boolean;
};

// --- „Verbesserung → Texte hochladen“ (Word files) ---------------------------------------------

/** One stored Word file in the table „Hochgeladene Texte“. */
export type ContentTextUploadView = {
  id: string;
  file_name: string;
  status: TextUploadStatus;
  /** „Fehler: …“, the pages of „mehrdeutig“, the other file of „doppelt“, „Seite nicht mehr in der Seitenstruktur“. */
  note: string | null;
  /** The assigned page of the Seitenstruktur. */
  structure: { slug: string; name: string; path: string | null } | null;
  sections: number;
  chars: number;
  uploaded_at: string | null;
  /** The row of the Texte table that uses this file (after „Zugeordnete Seiten übernehmen“). */
  page: { slug: string; name: string; state: ContentPageState } | null;
};

/** `GET /api/dt/content/uploads`. */
export type ContentTextUploadsResult = {
  /** False while the migration is missing; `hint` names the file. */
  supported: boolean;
  hint: string | null;
  /** Whether a Seitenstruktur is uploaded (without one the files wait). */
  has_structure: boolean;
  uploads: ContentTextUploadView[];
  /** Pages of the Seitenstruktur that have no file yet (the choices of the manual assignment). */
  free_pages: Array<{ slug: string; name: string; path: string | null }>;
  summary: {
    assigned: number;
    unassigned: number;
    /** Pages of the Seitenstruktur with a text to write („Nicht bearbeiten“ excluded) and no file. */
    pages_without_text: number;
    /** Assigned files that „Zugeordnete Seiten übernehmen“ would still bring into the table. */
    pending: number;
  };
};

/** `POST /api/dt/content/uploads`: one Word file read and stored (also when it could not be read: `error`). */
export type ContentTextUploadResult = { id: string; file_name: string; replaced: boolean; error: string | null };

/** `POST /api/dt/content/uploads/takeover`: „Zugeordnete Seiten übernehmen“. */
export type ContentTextUploadTakeoverResult = {
  created: number;
  attached: number;
  /** Attached rows that had started already: state and text stay, the file counts from the next run or after „Zurücksetzen“. */
  kept_started: number;
  already: number;
  over_limit: number;
  skipped: Array<{ file: string; reason: string }>;
  uploads: ContentTextUploadsResult;
  overview: ContentOverview;
};
