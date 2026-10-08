/**
 * What the `jobs` row behind a running page means for the person watching the table.
 * Pure, so the texts are testable; `reconcileContentPages` (pipeline/health.ts) loads the
 * rows and repairs pages whose job will never come back.
 */

import {
  CONTENT_STEP_COUNT,
  contentStepName,
  nextContentStep,
  runningPageDetail,
} from "@/lib/dt/content/pipeline/steps";
import { JOB_LOCK_TTL_MS } from "@/lib/jobs/schedule";
import type { JobStatus } from "@/lib/jobs/types";

export type ContentJobState = {
  id: string;
  status: JobStatus;
  run_after: string;
  locked_at: string | null;
  last_error: string | null;
  attempts: number;
  max_attempts: number;
};

/** A due job nobody claimed for this long: the database cron is not reaching the worker. */
export const CONTENT_WORKER_WAIT_WARN_MS = 90_000;

export type ContentJobVerdict =
  /** Claimed by a worker, lock still fresh: a step is being computed right now. */
  | { kind: "running" }
  /** Parked by the runner after a retryable error; `inMs` until the next attempt. */
  | { kind: "retry"; inMs: number; error: string | null }
  /** Due and unclaimed; `waitMs` since it became due. `error` when an earlier attempt failed. */
  | { kind: "queued"; waitMs: number; error: string | null }
  /** Claimed, but the lock is older than the TTL: the worker died mid-step. */
  | { kind: "stale_lock"; sinceMs: number }
  /** Finished, dead or missing: nothing will touch this page again. */
  | { kind: "gone"; status: JobStatus | null; error: string | null };

function epoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function judgeContentJob(job: ContentJobState | null, now = Date.now()): ContentJobVerdict {
  if (!job) return { kind: "gone", status: null, error: null };
  switch (job.status) {
    case "running": {
      const lockedAt = epoch(job.locked_at);
      if (lockedAt == null || now - lockedAt <= JOB_LOCK_TTL_MS) return { kind: "running" };
      return { kind: "stale_lock", sinceMs: now - lockedAt };
    }
    case "pending": {
      const due = epoch(job.run_after) ?? now;
      const error = job.attempts > 0 ? job.last_error : null;
      if (due > now) return { kind: "retry", inMs: due - now, error };
      return { kind: "queued", waitMs: now - due, error };
    }
    default:
      return { kind: "gone", status: job.status, error: job.last_error };
  }
}

function stepLabel(step: number | null): string | null {
  if (!step) return null;
  const name = contentStepName(step);
  return `Schritt ${step} von ${CONTENT_STEP_COUNT}${name ? `: ${name}` : ""}`;
}

function shortError(error: string | null): string {
  const text = (error ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return ` (${text.length > 160 ? `${text.slice(0, 157)}…` : text})`;
}

/**
 * Header line of a page in `laeuft`. Without job information this is the old text; with it,
 * a parked retry, an unclaimed job or a dead worker no longer read as „läuft“.
 * `steps` is null when the step rows were not loaded (then `page.step` is the best guess).
 */
export function describeRunningPage(
  page: { step: number | null; error: string | null },
  steps: readonly { step: number; status: string }[] | null,
  verdict: ContentJobVerdict | null,
): string {
  const current = page.step;
  const upcoming = steps ? (nextContentStep(steps) ?? current) : current;
  const plain = steps
    ? runningPageDetail(current, steps)
    : stepLabel(current)
      ? `${stepLabel(current)} läuft`
      : "Startet …";

  if (!verdict || verdict.kind === "running") return plain;

  const label = stepLabel(upcoming ?? 1) ?? "Start";
  switch (verdict.kind) {
    case "retry": {
      const minutes = Math.max(1, Math.ceil(verdict.inMs / 60_000));
      return `${label} – erneuter Versuch in ca. ${minutes} Min.${shortError(verdict.error)}`;
    }
    case "queued": {
      if (verdict.waitMs > CONTENT_WORKER_WAIT_WARN_MS) {
        const minutes = Math.max(1, Math.floor(verdict.waitMs / 60_000));
        return `Wartet seit ${minutes} Min. auf den Start – bleibt es dabei, bitte die Technik informieren`;
      }
      if (verdict.error) return `${label} – wird gleich erneut versucht${shortError(verdict.error)}`;
      return upcoming ? `${label} startet gleich` : "Startet …";
    }
    case "stale_lock":
      return `${label} wurde unterbrochen – wird fortgesetzt`;
    case "gone":
      return "Unterbrochen – bitte „Weiterlaufen lassen“";
  }
}

function minutesSince(iso: string | null, now: number): number | null {
  const t = epoch(iso);
  return t == null ? null : Math.max(0, Math.round((now - t) / 60_000));
}

/**
 * A step row still „running“ when a job is claimed means the previous worker died in the
 * middle of it (platform time limit, deploy, crash). The runner never saw a failure, so the
 * attempt counter would stay at zero and the same step would restart every lock-TTL forever.
 */
export function interruptedStepMessage(
  step: number,
  startedAt: string | null,
  job: { attempts: number; max_attempts: number },
  now = Date.now(),
): string {
  const name = contentStepName(step);
  const label = `Schritt ${step}${name ? ` (${name})` : ""}`;
  const since = minutesSince(startedAt, now);
  const ago = since != null ? ` (gestartet vor ${since} Min.)` : "";
  const attempt = job.attempts + 1;
  if (attempt >= job.max_attempts) {
    return `${label} wurde ${attempt}-mal abgebrochen, bevor die KI fertig war${ago} – vermutlich ein Zeitlimit. Mit „Weiterlaufen lassen“ noch einmal versuchen; bleibt es dabei, bitte die Technik informieren.`;
  }
  return `${label} wurde unterbrochen, bevor die KI fertig war${ago}. Versuch ${attempt} von ${job.max_attempts} – wird gleich wiederholt.`;
}
