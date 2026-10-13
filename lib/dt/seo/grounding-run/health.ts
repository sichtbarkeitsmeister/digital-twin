/**
 * Keeps the Grounding tab honest about background work: a page in `laeuft` whose job
 * finished, died or vanished would otherwise read „läuft“ forever.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTENT_WORKER_WAIT_WARN_MS, judgeContentJob, type ContentJobState, type ContentJobVerdict } from "@/lib/dt/content/job-state";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import type { DtGroundingPageRow } from "@/lib/dt/types";

export const GROUNDING_JOB_GONE_MESSAGE =
  "Der Entwurf wurde unterbrochen. Mit „Weiterlaufen lassen“ geht es an dieser Stelle weiter.";

const JOB_COLUMNS = "id, status, run_after, locked_at, last_error, attempts, max_attempts";

export async function reconcileGroundingPages(
  service: SupabaseClient,
  pages: readonly DtGroundingPageRow[],
  now = Date.now(),
): Promise<{ pages: DtGroundingPageRow[]; verdicts: Map<string, ContentJobVerdict> }> {
  const running = pages.filter((p) => p.run_state === "laeuft");
  const verdicts = new Map<string, ContentJobVerdict>();
  if (running.length === 0) return { pages: [...pages], verdicts };

  const ids = [...new Set(running.map((p) => p.job_id).filter((id): id is string => Boolean(id)))];
  const jobs = new Map<string, ContentJobState>();
  if (ids.length > 0) {
    const { data, error } = await service.from("jobs").select(JOB_COLUMNS).in("id", ids);
    if (error) throw new Error(`Jobs konnten nicht geladen werden: ${error.message}`);
    for (const row of (data ?? []) as ContentJobState[]) jobs.set(row.id, row);
  }

  const repaired = new Map<string, string>();
  const releaseJobIds: string[] = [];
  let kick = false;
  const finishedAt = new Date(now).toISOString();

  for (const page of running) {
    const job = page.job_id ? (jobs.get(page.job_id) ?? null) : null;
    const verdict = judgeContentJob(job, now);
    verdicts.set(page.id, verdict);
    if (verdict.kind === "gone") {
      const reason = verdict.error?.trim();
      const error =
        verdict.status === "dead" || verdict.status === "failed"
          ? `Abgebrochen: ${reason || "Der Durchlauf ist fehlgeschlagen."}`
          : GROUNDING_JOB_GONE_MESSAGE;
      const { error: updateError } = await service
        .from("dt_grounding_pages")
        .update({ run_state: "in_arbeit", run_error: error, job_id: null })
        .eq("id", page.id)
        .eq("run_state", "laeuft");
      if (updateError) continue;
      await service
        .from("dt_grounding_steps")
        .update({ status: "error", error, finished_at: finishedAt })
        .eq("page_id", page.id)
        .eq("status", "running");
      repaired.set(page.id, error);
    } else if (verdict.kind === "stale_lock") {
      if (job && !releaseJobIds.includes(job.id)) releaseJobIds.push(job.id);
      kick = true;
    } else if (verdict.kind === "queued" && verdict.waitMs > CONTENT_WORKER_WAIT_WARN_MS) {
      kick = true;
    }
  }

  if (releaseJobIds.length > 0) {
    await service
      .from("jobs")
      .update({ status: "pending", locked_at: null, locked_by: null, run_after: finishedAt })
      .in("id", releaseJobIds)
      .eq("status", "running");
  }
  if (kick) kickJobsWorker(1);

  const next = pages.map((page) => {
    const error = repaired.get(page.id);
    return error ? { ...page, run_state: "in_arbeit" as const, run_error: error, job_id: null } : page;
  });
  return { pages: next, verdicts };
}
