import { randomUUID } from "crypto";

import { createServiceClient } from "@/lib/supabase/service";

import { findHandler } from "./registry";
import type { JobRow } from "./types";

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
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
 * Pull a batch of due jobs and execute them. Each tick is bounded — the
 * cron schedule (every 30 s) will pick up the next batch.
 *
 * Concurrency is achieved via row-level locks (FOR UPDATE SKIP LOCKED)
 * inside the claim_jobs() RPC so that overlapping ticks don't double-run.
 *
 * For Phase 1 we keep this single-process. Multi-instance scaling can be
 * added later by raising batch size and/or running ticks more often.
 */
export async function runDueJobs(
  options: { batchSize?: number } = {},
): Promise<RunnerSummary> {
  const startedAt = Date.now();
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

  const claimedAt = new Date().toISOString();

  // Atomically claim a batch of due jobs by setting status='running' on
  // the oldest pending rows whose run_after has passed. We rely on a
  // CTE update so two concurrent ticks won't grab the same rows.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_due_jobs",
    {
      p_batch: batchSize,
      p_worker: workerId,
      p_now: claimedAt,
    },
  );

  if (claimError) {
    if (claimError.code === "42883") {
      // Function doesn't exist yet (race during first deploy). Skip silently.
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
    console.error("[jobs] claim failed", claimError);
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const jobs = (claimed ?? []) as JobRow[];
  summary.picked = jobs.length;

  for (const job of jobs) {
    const handler = findHandler(job.kind);

    if (!handler) {
      await markFailed(job, `No handler registered for kind=${job.kind}`, {
        force: true,
      });
      summary.dead += 1;
      continue;
    }

    try {
      const outcome = await handler({ job });
      if (outcome.ok) {
        await markSucceeded(job, outcome.result ?? null);
        summary.succeeded += 1;
      } else {
        await markFailed(job, outcome.error, {
          force: outcome.retryable === false,
        });
        if (outcome.retryable === false || job.attempts + 1 >= job.max_attempts) {
          summary.dead += 1;
        } else {
          summary.failed += 1;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] handler ${job.kind} threw`, error);
      await markFailed(job, message);
      if (job.attempts + 1 >= job.max_attempts) {
        summary.dead += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  // Recover locks held by this worker that are older than the TTL — in case
  // we crashed mid-run before marking the job. Status stays 'running' but
  // we reset it to 'pending' so the next tick can retry.
  await supabase
    .from("jobs")
    .update({
      status: "pending",
      locked_at: null,
      locked_by: null,
    })
    .eq("status", "running")
    .lt(
      "locked_at",
      new Date(Date.now() - DEFAULT_LOCK_TTL_MS).toISOString(),
    );

  summary.durationMs = Date.now() - startedAt;
  return summary;
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
