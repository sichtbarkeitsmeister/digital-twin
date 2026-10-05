/**
 * Content-Agent API contract (Python/FastAPI service, `/api/v1/...`).
 * Shapes mirror the service JSON 1:1 (snake_case) so the proxy can pass them through.
 */

export type ContentPageState =
  | "nicht_begonnen"
  | "laeuft"
  | "in_arbeit"
  | "braucht_sie"
  | "fertig";

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

export type ContentActionKind = "approve" | "edit" | "rerun_with_note" | "run_through" | "export";

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
  /** Workshop sections (`dt_workshop_corpus.anbieter`) with text; null when none has text. */
  anbieter: { filled: number; total: number } | null;
  avatarCount: number;
  structure: { filename: string | null } | null;
};

/** What `/api/dt/content/*` returns to the browser. */
export type ContentApiResponse<T> =
  | { ok: true; demo: boolean; data: T }
  | { ok: false; message: string };
