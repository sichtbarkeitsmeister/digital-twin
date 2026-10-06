import { randomUUID } from "crypto";

import { createServiceClient } from "@/lib/supabase/service";

import { findHandler } from "./registry";
import { JOB_LOCK_TTL_MS, JOB_WORKER_BUDGET_MS, shouldClaimAnotherJob } from "./schedule";
import type { JobRow } from "./types";

const DEFAULT_BATCH_SIZE = 5;
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;

export type RunnerSummary = {
  picked: number;
  succeeded: number;
  failed: number;
  dead: number;
  workerId: string;
  durationMs: number;
};

/**
 * Pull due jobs and execute them. One job is claimed at a time: claiming a whole
 * batch up front left later jobs `running` when the tick was cut off, so they never ran.
 *
 * Stale locks are released first. A tick that dies mid-step used to leave the job
 * `running`, and the release lived at the end of the tick — which never ran.
 *
 * Concurrency uses row locks (FOR UPDATE SKIP LOCKED) inside claim_due_jobs.
 */
export async function runDueJobs(
  options: { batchSize?: number } = {},
): Promise<RunnerSummary> {
  const startedAt = Date.now();
  const deadline = startedAt + JOB_WORKER_BUDGET_MS;
  const workerId = `worker-${randomUUID()}`;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const supabase = createServiceClient();

  const summary: RunnerSummary = {
    picked: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    workerId,
    durationMs: 0,
  };

  await releaseStaleLocks(supabase);

  while (shouldClaimAnotherJob(Date.now(), deadline, summary.picked, batchSize)) {
    const claimed = await claimOne(supabase, workerId);
    if (claimed === "missing") break;
    if (!claimed) break;
    summary.picked += 1;
    await executeJob(claimed, deadline, summary);
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

async function releaseStaleLocks(supabase: ReturnType<typeof createServiceClient>): Promise<void> {
  const cutoff = new Date(Date.now() - JOB_LOCK_TTL_MS).toISOString();
  const { error } = await supabase
    .from("jobs")
    .update({ status: "pending", locked_at: null, locked_by: null })
    .eq("status", "running")
    .lt("locked_at", cutoff);
  if (error) console.error("[jobs] stale lock release failed", error);
}

async function claimOne(
  supabase: ReturnType<typeof createServiceClient>,
  workerId: string,
): Promise<JobRow | null | "missing"> {
  const { data, error } = await supabase.rpc("claim_due_jobs", {
    p_batch: 1,
    p_worker: workerId,
    p_now: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "42883") return "missing";
    console.error("[jobs] claim failed", error);
    return null;
  }
  const rows = (data ?? []) as JobRow[];
  return rows[0] ?? null;
}

async function executeJob(job: JobRow, deadline: number, summary: RunnerSummary): Promise<void> {
  const handler = findHandler(job.kind);

  if (!handler) {
    await markFailed(job, `No handler registered for kind=${job.kind}`, { force: true });
    if (job.kind === "seo.crawl") {
      await markSeoCrawlDead(job, `No handler registered for kind=${job.kind}`);
    }
    summary.dead += 1;
    return;
  }

  try {
    const outcome = await handler({ job, deadline });
    if (outcome.ok) {
      if (outcome.reschedule) {
        await markReschedule(job, outcome.result ?? null);
      } else {
        await markSucceeded(job, outcome.result ?? null);
      }
      summary.succeeded += 1;
    } else {
      await markFailed(job, outcome.error, { force: outcome.retryable === false });
      const exhausted = outcome.retryable === false || job.attempts + 1 >= job.max_attempts;
      if (exhausted && job.kind === "seo.crawl") {
        await markSeoCrawlDead(job, outcome.error);
      }
      if (exhausted) summary.dead += 1;
      else summary.failed += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jobs] handler ${job.kind} threw`, error);
    await markFailed(job, message);
    const exhausted = job.attempts + 1 >= job.max_attempts;
    if (exhausted && job.kind === "seo.crawl") {
      await markSeoCrawlDead(job, message);
    }
    if (exhausted) summary.dead += 1;
    else summary.failed += 1;
  }
}

async function markReschedule(
  job: JobRow,
  result: Record<string, unknown> | null,
) {
  const supabase = createServiceClient();
  await supabase
    .from("jobs")
    .update({
      status: "pending",
      result,
      run_after: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    })
    .eq("id", job.id)
    .eq("status", "running");
}

async function markSucceeded(
  job: JobRow,
  result: Record<string, unknown> | null,
) {
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({
      status: "succeeded",
      result,
      completed_at: now,
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq("id", job.id);
}

async function markFailed(
  job: JobRow,
  errorMessage: string,
  opts: { force?: boolean } = {},
) {
  const supabase = createServiceClient();
  const nextAttempts = job.attempts + 1;
  const exhausted = opts.force === true || nextAttempts >= job.max_attempts;
  const backoffMs = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * Math.pow(2, Math.max(0, nextAttempts - 1)),
  );
  const runAfter = exhausted
    ? job.run_after
    : new Date(Date.now() + backoffMs).toISOString();
  const now = new Date().toISOString();

  await supabase
    .from("jobs")
    .update({
      status: exhausted ? "dead" : "pending",
      attempts: nextAttempts,
      last_error: errorMessage.slice(0, 4000),
      run_after: runAfter,
      completed_at: exhausted ? now : null,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", job.id);
}

async function markSeoCrawlDead(job: JobRow, errorMessage: string) {
  const crawlId = (job.payload as { crawlId?: string })?.crawlId;
  if (!crawlId) return;
  const supabase = createServiceClient();
  await supabase
    .from("dt_site_crawls")
    .update({
      status: "error",
      message: errorMessage.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq("id", crawlId)
    .in("status", ["queued", "running"]);
}
