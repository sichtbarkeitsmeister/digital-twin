/**
 * Keeps the Grounding tab honest about background work: a check in „running“ whose job
 * finished, died or vanished would otherwise read „Prüfung läuft“ forever.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { judgeContentJob, type ContentJobState } from "@/lib/dt/content/job-state";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import type { DtGroundingRunRow } from "@/lib/dt/types";

const JOB_COLUMNS = "id, status, run_after, locked_at, last_error, attempts, max_attempts";

export const GROUNDING_CHECK_JOB_GONE = "Die Prüfung wurde unterbrochen. Bitte „Website prüfen“ erneut starten.";

/**
 * Runs that say „running“ but whose job finished, died or vanished are marked failed, so the
 * tab never waits forever. Stale locks are released and the worker is kicked.
 */
export async function reconcileGroundingRuns(service: SupabaseClient, rows: DtGroundingRunRow[], now = Date.now()): Promise<DtGroundingRunRow[]> {
  const running = rows.filter((r) => r.status === "running");
  if (running.length === 0) return rows;
  const ids = running.map((r) => r.job_id).filter((id): id is string => Boolean(id));
  const jobs = new Map<string, ContentJobState>();
  if (ids.length > 0) {
    const { data } = await service.from("jobs").select(JOB_COLUMNS).in("id", ids);
    for (const job of (data ?? []) as ContentJobState[]) jobs.set(job.id, job);
  }
  const failed = new Map<string, string>();
  let kick = false;
  for (const run of running) {
    // A fresh run may not have its job id yet.
    if (!run.job_id && now - new Date(run.created_at).getTime() < 5 * 60_000) continue;
    const verdict = judgeContentJob(run.job_id ? (jobs.get(run.job_id) ?? null) : null, now);
    if (verdict.kind === "gone") {
      const message =
        verdict.status === "dead" || verdict.status === "failed"
          ? `Abgebrochen: ${verdict.error?.trim() || "Die Prüfung ist fehlgeschlagen."}`
          : GROUNDING_CHECK_JOB_GONE;
      const { error } = await service
        .from("dt_grounding_runs")
        .update({ status: "failed", error: message.slice(0, 500), finished_at: new Date(now).toISOString(), job_id: null })
        .eq("id", run.id)
        .eq("status", "running");
      if (!error) failed.set(run.id, message);
    } else if (verdict.kind === "stale_lock" && run.job_id) {
      await service
        .from("jobs")
        .update({ status: "pending", locked_at: null, locked_by: null, run_after: new Date(now).toISOString() })
        .eq("id", run.job_id)
        .eq("status", "running");
      kick = true;
    } else if (verdict.kind === "queued" && verdict.waitMs > 90_000) {
      kick = true;
    }
  }
  if (kick) kickJobsWorker(1);
  return rows.map((r) => (failed.has(r.id) ? { ...r, status: "failed" as const, error: failed.get(r.id)!, job_id: null } : r));
}
