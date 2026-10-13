/**
 * Rows, steps and the run view of the Grounding agent. The draft lives on
 * `dt_grounding_pages` (migration 20261013_dt_grounding_drafts.sql), one row per step in
 * `dt_grounding_steps`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { judgeContentJob, type ContentJobVerdict } from "@/lib/dt/content/job-state";
import {
  GROUNDING_STEP_COUNT,
  GROUNDING_STEPS,
  groundingStepLabel,
  nextGroundingStep,
  runningGroundingDetail,
} from "@/lib/dt/seo/grounding-run/steps";
import {
  normalizeGroundingFacts,
  normalizeGroundingFindings,
  normalizeGroundingQuestions,
  type GroundingEntityCandidate,
  type GroundingFacts,
  type GroundingFinding,
  type GroundingQuestion,
} from "@/lib/dt/seo/grounding-run/prompts";
import type { DtGroundingPageRow, DtGroundingRunState, DtGroundingStepRow } from "@/lib/dt/types";

export const GROUNDING_DRAFTS_MIGRATION_FILE = "database/migrations/20261013_dt_grounding_drafts.sql";

export const GROUNDING_STEP_COLUMNS =
  "id, page_id, organisation_id, step, name, status, output, model, input_tokens, output_tokens, cost_eur, error, started_at, finished_at";

/** `column … does not exist` / PGRST204: the drafts migration never ran. */
export function isMissingGroundingRunColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /column .+ does not exist|could not find the '.+' column|schema cache/i.test(message)
  );
}

export function groundingRunDbErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (isMissingGroundingRunColumnError(error)) {
    return `Die Datenbank ist noch nicht vorbereitet: Bitte ${GROUNDING_DRAFTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`;
  }
  return `${fallback}: ${error.message ?? "Unbekannter Fehler"}`;
}

export function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatEur(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

export function groundingRunNotes(row: Pick<DtGroundingPageRow, "run_notes">): string[] {
  return Array.isArray(row.run_notes)
    ? row.run_notes.filter((n): n is string => typeof n === "string" && n.trim() !== "")
    : [];
}

export function groundingRunFacts(row: Pick<DtGroundingPageRow, "facts" | "kind" | "entity_name" | "url" | "entity_type">): GroundingFacts | null {
  if (!row.facts || typeof row.facts !== "object") return null;
  return normalizeGroundingFacts(row.facts, {
    page: {
      kind: row.kind,
      entityName: row.entity_name ?? "",
      slug: null,
      url: row.url,
      schemaType: row.entity_type,
    },
  });
}

export function groundingRunQuestions(row: Pick<DtGroundingPageRow, "questions">): GroundingQuestion[] {
  return normalizeGroundingQuestions(row.questions);
}

export function groundingRunFindings(row: Pick<DtGroundingPageRow, "findings">): GroundingFinding[] {
  return normalizeGroundingFindings(row.findings);
}

export async function loadGroundingSteps(service: SupabaseClient, pageId: string): Promise<DtGroundingStepRow[]> {
  const { data, error } = await service
    .from("dt_grounding_steps")
    .select(GROUNDING_STEP_COLUMNS)
    .eq("page_id", pageId)
    .order("step", { ascending: true });
  if (error) throw new Error(groundingRunDbErrorMessage(error, "Schritte konnten nicht geladen werden"));
  return (data ?? []) as DtGroundingStepRow[];
}

export async function loadGroundingStepsForPages(
  service: SupabaseClient,
  pageIds: readonly string[],
): Promise<Map<string, DtGroundingStepRow[]>> {
  const byPage = new Map<string, DtGroundingStepRow[]>();
  if (pageIds.length === 0) return byPage;
  const { data, error } = await service
    .from("dt_grounding_steps")
    .select(GROUNDING_STEP_COLUMNS)
    .in("page_id", [...pageIds])
    .order("step", { ascending: true });
  if (error) throw new Error(groundingRunDbErrorMessage(error, "Schritte konnten nicht geladen werden"));
  for (const row of (data ?? []) as DtGroundingStepRow[]) {
    const list = byPage.get(row.page_id) ?? [];
    list.push(row);
    byPage.set(row.page_id, list);
  }
  return byPage;
}

// --- run view (what the Grounding tab shows) ---------------------------------------------------

export type DtGroundingRunStepView = {
  step: number;
  name: string;
  status: DtGroundingStepRow["status"] | "pending";
  costEur: number;
};

export type DtGroundingRunView = {
  state: DtGroundingRunState;
  step: number | null;
  stepCount: number;
  label: string;
  detail: string | null;
  error: string | null;
  hasHtml: boolean;
  title: string | null;
  metaDescription: string | null;
  schemaType: string | null;
  costEur: number;
  cost: string;
  questions: GroundingQuestion[];
  findings: GroundingFinding[];
  notes: string[];
  /** Compact fact base for the card: definition, core facts, open questions, candidates. */
  facts: {
    definition: string;
    placement: string;
    coreFacts: Array<{ label: string; value: string; asOf: string | null }>;
    sections: string[];
    openQuestions: string[];
    candidates: GroundingEntityCandidate[];
  } | null;
  /** The Endprüfung's note for the reviewer. */
  summary: string | null;
  steps: DtGroundingRunStepView[];
};

const STATE_LABELS: Record<DtGroundingRunState, string> = {
  nicht_begonnen: "Kein Entwurf",
  laeuft: "Entwurf läuft",
  in_arbeit: "Entwurf pausiert",
  braucht_sie: "Braucht Ihre Antworten",
  fertig: "Entwurf fertig – bereit zur Prüfung",
};

function finalSummary(steps: readonly DtGroundingStepRow[]): string | null {
  const row = steps.find((s) => s.step === GROUNDING_STEP_COUNT && (s.status === "done" || s.status === "waiting"));
  const output = row?.output;
  if (!output || typeof output !== "object") return null;
  const summary = (output as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

export function buildGroundingRunView(
  row: DtGroundingPageRow,
  steps: readonly DtGroundingStepRow[],
  verdict: ContentJobVerdict | null,
): DtGroundingRunView {
  const state = row.run_state ?? "nicht_begonnen";
  const facts = groundingRunFacts(row);
  let detail: string | null = null;
  if (state === "laeuft") {
    detail = describeRunning(row, steps, verdict);
  } else if (state === "in_arbeit") {
    detail = row.run_error ?? `${groundingStepLabel(nextGroundingStep(steps) ?? row.run_step ?? 1)} wartet – „Weiterlaufen lassen“.`;
  } else if (state === "braucht_sie") {
    detail = "Der Faktencheck hat Fragen, die nur Sie beantworten können.";
  } else if (state === "fertig") {
    detail = "HTML-Datei herunterladen, auf der Website einfügen, Fakten prüfen und die Freigabe dokumentieren.";
  }
  return {
    state,
    step: row.run_step,
    stepCount: GROUNDING_STEP_COUNT,
    label: STATE_LABELS[state],
    detail,
    error: row.run_error,
    hasHtml: Boolean(row.html?.trim()),
    title: row.title,
    metaDescription: row.meta_description,
    schemaType: row.entity_type,
    costEur: num(row.cost_eur),
    cost: formatEur(num(row.cost_eur)),
    questions: groundingRunQuestions(row),
    findings: groundingRunFindings(row),
    notes: groundingRunNotes(row),
    facts: facts
      ? {
          definition: facts.entity.definition,
          placement: facts.entity.placement,
          coreFacts: facts.core_facts.map((f) => ({ label: f.label, value: f.value, asOf: f.as_of })),
          sections: facts.sections.map((s) => s.heading),
          openQuestions: facts.open_questions.map((q) => q.question),
          candidates: facts.entity_candidates,
        }
      : null,
    summary: finalSummary(steps),
    steps: GROUNDING_STEPS.map((def) => {
      const s = steps.find((r) => r.step === def.step);
      return { step: def.step, name: def.name, status: s?.status ?? "pending", costEur: num(s?.cost_eur) };
    }),
  };
}

function describeRunning(
  row: DtGroundingPageRow,
  steps: readonly DtGroundingStepRow[],
  verdict: ContentJobVerdict | null,
): string {
  const plain = runningGroundingDetail(row.run_step, steps);
  if (!verdict || verdict.kind === "running") return plain;
  const upcoming = nextGroundingStep(steps) ?? row.run_step ?? 1;
  const label = groundingStepLabel(upcoming);
  switch (verdict.kind) {
    case "retry": {
      const minutes = Math.max(1, Math.ceil(verdict.inMs / 60_000));
      return `${label} – erneuter Versuch in ca. ${minutes} Min.${verdict.error ? ` (${verdict.error.slice(0, 160)})` : ""}`;
    }
    case "queued":
      if (verdict.waitMs > 90_000) {
        return `Wartet seit ${Math.max(1, Math.floor(verdict.waitMs / 60_000))} Min. auf den Start – bleibt es dabei, bitte die Technik informieren`;
      }
      return `${label} startet gleich`;
    case "stale_lock":
      return `${label} wurde unterbrochen – wird fortgesetzt`;
    case "gone":
      return "Unterbrochen – bitte „Weiterlaufen lassen“";
  }
}

export { judgeContentJob };
