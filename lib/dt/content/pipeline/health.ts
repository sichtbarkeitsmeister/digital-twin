/**
 * Keeps the Texte table honest about background work, the way `syncCrawlJobHealth` does for
 * crawls. A page in `laeuft` whose job finished, died or vanished would otherwise read „läuft“
 * forever — and `laeuft` disables every button, so only SQL could free it.
 *
 * `planContentPageRepairs` is pure (tests); `reconcileContentPages` loads the job rows and
 * applies the plan. Routes call it before they build the overview or start a page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONTENT_WORKER_WAIT_WARN_MS,
  judgeContentJob,
  type ContentJobState,
  type ContentJobVerdict,
} from "@/lib/dt/content/job-state";
import { loadContentPageById, type ContentPageRow } from "@/lib/dt/content/store";

export const CONTENT_JOB_GONE_MESSAGE =
  "Der Durchlauf wurde unterbrochen. Mit „Weiterlaufen lassen“ geht es an dieser Stelle weiter.";

export type ContentPageRepair = {
  pageId: string;
  step: number | null;
  /** Goes on the page row and on the step row that was still „running“. */
  error: string;
};

export type ContentHealthPlan = {
  verdicts: Map<string, ContentJobVerdict>;
  /** Pages to move from `laeuft` to `in_arbeit`, with the reason visible in table and drawer. */
  repairs: ContentPageRepair[];
  /** Jobs whose lock is older than the TTL: free them so the next tick continues the page. */
  releaseJobIds: string[];
  /** A due job waited longer than the warning window: poke the worker from this request. */
  kick: boolean;
};

export function planContentPageRepairs(
  pages: readonly ContentPageRow[],
  jobs: ReadonlyMap<string, ContentJobState>,
  now = Date.now(),
): ContentHealthPlan {
  const plan: ContentHealthPlan = { verdicts: new Map(), repairs: [], releaseJobIds: [], kick: false };

  for (const page of pages) {
    if (page.state !== "laeuft") continue;
    const job = page.job_id ? (jobs.get(page.job_id) ?? null) : null;
    const verdict = judgeContentJob(job, now);
    plan.verdicts.set(page.id, verdict);

    switch (verdict.kind) {
      case "gone": {
        const reason = verdict.error?.trim();
        const error =
          verdict.status === "dead" || verdict.status === "failed"
            ? `Abgebrochen: ${reason || "Der Durchlauf ist fehlgeschlagen."}`
            : CONTENT_JOB_GONE_MESSAGE;
        plan.repairs.push({ pageId: page.id, step: page.step, error });
        break;
      }
      case "stale_lock":
        if (job && !plan.releaseJobIds.includes(job.id)) plan.releaseJobIds.push(job.id);
        plan.kick = true;
        break;
      case "queued":
        if (verdict.waitMs > CONTENT_WORKER_WAIT_WARN_MS) plan.kick = true;
        break;
      default:
        break;
    }
  }
  return plan;
}

const JOB_COLUMNS = "id, status, run_after, locked_at, last_error, attempts, max_attempts";

export async function loadContentJobStates(
  service: SupabaseClient,
  jobIds: readonly string[],
): Promise<Map<string, ContentJobState>> {
  const map = new Map<string, ContentJobState>();
  const ids = [...new Set(jobIds)];
  if (ids.length === 0) return map;
  const { data, error } = await service.from("jobs").select(JOB_COLUMNS).in("id", ids);
  if (error) throw new Error(`Jobs konnten nicht geladen werden: ${error.message}`);
  for (const row of (data ?? []) as ContentJobState[]) map.set(row.id, row);
  return map;
}

/**
 * Repairs stale running pages and returns the rows as they are now, plus what each remaining
 * running page's job is doing (for the detail text). Pages that are not `laeuft` cost nothing.
 *
 * The page rows are read before the jobs. A run that ends in between (page saved as „fertig“,
 * then its job marked „succeeded“) looks like a page whose job is gone. The repair only applies
 * to a page that is still `laeuft`; any other is returned as it is now, without the message
 * „Der Durchlauf wurde unterbrochen“ (shown wrongly before, 11.11.).
 */
export async function reconcileContentPages(
  service: SupabaseClient,
  pages: readonly ContentPageRow[],
  now = Date.now(),
): Promise<{ pages: ContentPageRow[]; verdicts: Map<string, ContentJobVerdict> }> {
  const running = pages.filter((p) => p.state === "laeuft");
  if (running.length === 0) return { pages: [...pages], verdicts: new Map() };

  const jobs = await loadContentJobStates(
    service,
    running.map((p) => p.job_id).filter((id): id is string => Boolean(id)),
  );
  const plan = planContentPageRepairs(running, jobs, now);
  const repaired = new Map(plan.repairs.map((r) => [r.pageId, r]));
  const finishedAt = new Date(now).toISOString();

  // Pages that changed between reading the row and reading its job: shown as they are now.
  const fresh = new Map<string, ContentPageRow>();
  for (const repair of plan.repairs) {
    const { data: hit, error } = await service
      .from("dt_content_pages")
      .update({ state: "in_arbeit", error: repair.error, job_id: null })
      .eq("id", repair.pageId)
      .eq("state", "laeuft")
      .select("id");
    if (error) {
      console.error("[content] page repair failed", error);
      repaired.delete(repair.pageId);
      continue;
    }
    if (!hit || hit.length === 0) {
      // Not „laeuft“ any more: the run ended between the two reads (the page is saved as
      // „fertig“ or „braucht Sie“ a moment before its job is marked done). Nothing was
      // interrupted; the table must not say so. It shows the row as it is now instead.
      repaired.delete(repair.pageId);
      plan.verdicts.delete(repair.pageId);
      const now = await loadContentPageById(service, repair.pageId).catch(() => null);
      if (now) fresh.set(repair.pageId, now);
      continue;
    }
    await service
      .from("dt_content_steps")
      .update({ status: "error", error: repair.error, finished_at: finishedAt })
      .eq("page_id", repair.pageId)
      .eq("status", "running");
  }

  if (plan.releaseJobIds.length > 0) {
    await service
      .from("jobs")
      .update({ status: "pending", locked_at: null, locked_by: null, run_after: finishedAt })
      .in("id", plan.releaseJobIds)
      .eq("status", "running");
  }
  if (plan.kick) {
    // Loaded on demand: the worker brings the whole jobs registry (every handler, some of them
    // server-only) into the module graph, which the pure parts of this module and their tests do not need.
    const { kickJobsWorker } = await import("@/lib/jobs/kick-worker");
    kickJobsWorker(1);
  }

  const next = pages.map((page) => {
    const now = fresh.get(page.id);
    if (now) return now;
    const repair = repaired.get(page.id);
    return repair ? { ...page, state: "in_arbeit" as const, error: repair.error, job_id: null } : page;
  });
  return { pages: next, verdicts: plan.verdicts };
}
