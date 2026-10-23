/**
 * Rows and views of dt_grounding_runs (migration 20261023_dt_grounding_runs.sql).
 * The repair of runs whose job died lives in health.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GROUNDING_DECISION_LABELS } from "@/lib/dt/seo/grounding-check/decision";
import type { GroundingDiff } from "@/lib/dt/seo/grounding-check/diff";
import {
  type GroundingFactModel,
  type GroundingOpenPoint,
  groundingOpenPointSchema,
  parseGroundingFactModel,
} from "@/lib/dt/seo/grounding-check/fact-model";
import { EMPTY_HINTS, type CrawledUrlEntry, type GroundingHints, type ReviewChecklist } from "@/lib/dt/seo/grounding-check/types";
import type { GroundingValidation } from "@/lib/dt/seo/grounding-check/validate";
import type {
  DtGroundingRunDecision,
  DtGroundingRunRow,
  DtGroundingRunStatus,
  DtGroundingRunStep,
  DtGroundingRunTrigger,
} from "@/lib/dt/types";

export const GROUNDING_RUNS_MIGRATION_FILE = "database/migrations/20261023_dt_grounding_runs.sql";

export const RUN_SUMMARY_COLUMNS =
  "id, organisation_id, trigger, status, step, decision, grounding_url_checked, llms_txt_url_checked, standard_version, model, input_tokens, output_tokens, cost_eur, job_id, error, created_by, created_at, updated_at, finished_at, reviewed_by, reviewed_at, reviewer_name, review_note, uploaded_at, uploaded_url";
export const RUN_DETAIL_COLUMNS = `${RUN_SUMMARY_COLUMNS}, crawled_urls, fact_model, existing_fact_model, diff, open_points, hints, validation, draft_html, draft_llms_txt, review_checklist`;
export const RUN_JOB_COLUMNS = `${RUN_DETAIL_COLUMNS}, crawl_snapshot`;

/** A run that still needs a person (or is still working): blocks a scheduled check. */
export const OPEN_RUN_STATUSES: readonly DtGroundingRunStatus[] = ["running", "draft", "approved"];

export function isMissingGroundingRunsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/dt_grounding_runs/.test(message) && /does not exist|schema cache|could not find/i.test(message))
  );
}

export function groundingRunsDbErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (isMissingGroundingRunsTable(error)) {
    return `Die Datenbank ist noch nicht vorbereitet: Bitte ${GROUNDING_RUNS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`;
  }
  return `${fallback}: ${error.message ?? "Unbekannter Fehler"}`;
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const STEP_LABELS: Record<DtGroundingRunStep, string> = {
  crawl: "Website lesen",
  extract: "Fakten erfassen",
  compare: "Mit der Grounding Page vergleichen",
  generate: "Entwurf erstellen",
  done: "Fertig",
};

const STATUS_LABELS: Record<DtGroundingRunStatus, string> = {
  running: "Prüfung läuft",
  up_to_date: "Aktuell",
  draft: "Entwurf wartet auf Prüfung",
  approved: "Freigegeben, noch nicht hochgeladen",
  rejected: "Abgelehnt",
  uploaded: "Hochgeladen",
  failed: "Fehlgeschlagen",
};

export type GroundingRunSummary = {
  id: string;
  organisationId: string;
  trigger: DtGroundingRunTrigger;
  triggerLabel: string;
  status: DtGroundingRunStatus;
  statusLabel: string;
  step: DtGroundingRunStep;
  stepLabel: string;
  decision: DtGroundingRunDecision | null;
  decisionLabel: string | null;
  groundingUrl: string | null;
  llmsTxtUrl: string | null;
  standardVersion: string;
  model: string | null;
  costEur: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  reviewNote: string | null;
  uploadedAt: string | null;
  uploadedUrl: string | null;
};

export type GroundingRunDetail = GroundingRunSummary & {
  crawledUrls: CrawledUrlEntry[];
  factModel: GroundingFactModel | null;
  existingFactModel: GroundingFactModel | null;
  diff: GroundingDiff | null;
  openPoints: GroundingOpenPoint[];
  hints: GroundingHints;
  validation: GroundingValidation | null;
  draftHtml: string | null;
  draftLlmsTxt: string | null;
  reviewChecklist: ReviewChecklist | null;
};

export function serializeRunSummary(row: DtGroundingRunRow): GroundingRunSummary {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    trigger: row.trigger,
    triggerLabel: row.trigger === "schedule" ? "automatisch" : "manuell",
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    step: row.step,
    stepLabel: STEP_LABELS[row.step] ?? row.step,
    decision: row.decision,
    decisionLabel: row.decision ? GROUNDING_DECISION_LABELS[row.decision] : null,
    groundingUrl: row.grounding_url_checked,
    llmsTxtUrl: row.llms_txt_url_checked,
    standardVersion: row.standard_version,
    model: row.model,
    costEur: num(row.cost_eur),
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewer_name,
    reviewNote: row.review_note,
    uploadedAt: row.uploaded_at,
    uploadedUrl: row.uploaded_url,
  };
}

function isDiff(value: unknown): value is GroundingDiff {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as GroundingDiff).items);
}

export function serializeRunDetail(row: DtGroundingRunRow): GroundingRunDetail {
  const openPoints = Array.isArray(row.open_points)
    ? row.open_points.flatMap((p) => {
        const parsed = groundingOpenPointSchema.safeParse(p);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const validation = row.validation && typeof row.validation === "object" ? (row.validation as GroundingValidation) : null;
  return {
    ...serializeRunSummary(row),
    crawledUrls: Array.isArray(row.crawled_urls) ? (row.crawled_urls as CrawledUrlEntry[]) : [],
    factModel: parseGroundingFactModel(row.fact_model),
    existingFactModel: parseGroundingFactModel(row.existing_fact_model),
    diff: isDiff(row.diff) ? row.diff : null,
    openPoints,
    hints: { ...EMPTY_HINTS, ...((row.hints as Partial<GroundingHints> | null) ?? {}) },
    validation,
    draftHtml: row.draft_html,
    draftLlmsTxt: row.draft_llms_txt,
    reviewChecklist: row.review_checklist && typeof row.review_checklist === "object" ? (row.review_checklist as ReviewChecklist) : null,
  };
}

/** The headline of the Grounding tab: what the latest check means for the page. */
export function groundingCheckHeadline(latest: GroundingRunSummary | null): { label: string; tone: "ok" | "warn" | "info" | "error" | "running" } {
  if (!latest) return { label: "Noch nicht geprüft", tone: "info" };
  switch (latest.status) {
    case "running":
      return { label: `Prüfung läuft · ${latest.stepLabel}`, tone: "running" };
    case "failed":
      return { label: "Prüfung fehlgeschlagen", tone: "error" };
    case "up_to_date":
      return { label: "Aktuell", tone: "ok" };
    case "draft":
      return { label: "Entwurf wartet auf Prüfung", tone: "warn" };
    case "approved":
      return { label: "Freigegeben · bitte hochladen", tone: "warn" };
    case "uploaded":
      return { label: "Aktuell (hochgeladen)", tone: "ok" };
    case "rejected":
      return {
        label: latest.decision === "create" ? "Keine Grounding Page" : "Aktualisierung empfohlen",
        tone: "warn",
      };
  }
}

export async function loadRunRow(service: SupabaseClient, runId: string, columns = RUN_DETAIL_COLUMNS): Promise<DtGroundingRunRow | null> {
  const { data, error } = await service.from("dt_grounding_runs").select(columns).eq("id", runId).maybeSingle();
  if (error) throw new Error(groundingRunsDbErrorMessage(error, "Prüfung konnte nicht geladen werden"));
  return (data as unknown as DtGroundingRunRow | null) ?? null;
}
