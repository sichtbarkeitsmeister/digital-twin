export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "dead";

export type JobKind =
  | "leadinfo.normalize"
  | "seo.crawl"
  | "apollo.enrich"
  | "outreach.draft"
  | "outreach.send"
  | "outreach.classify_reply"
  | "outreach.plan_next"
  | "outreach.followup_due";

export type JobRow = {
  id: string;
  organisation_id: string | null;
  kind: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  run_after: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: Record<string, unknown> | null;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EnqueueJobInput = {
  kind: JobKind | string;
  organisationId?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
};

export type JobHandlerContext = {
  job: JobRow;
};

export type JobHandlerResult =
  | { ok: true; result?: Record<string, unknown> }
  | { ok: false; error: string; retryable?: boolean };

export type JobHandler = (ctx: JobHandlerContext) => Promise<JobHandlerResult>;
