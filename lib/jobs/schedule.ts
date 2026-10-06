/**
 * How long one worker wake-up may run, and when a lock is abandoned.
 * The database cron calls `/api/jobs/run` and used to wait only 120s. A tick that had
 * already claimed several jobs was cut off, and every job it had not reached stayed
 * `running` — so the next Texte step never started. The route now answers at once and
 * finishes the work afterwards (`after`). The budget stays under the route maxDuration
 * (300s). The lock TTL stays longer than the budget so a live step is not claimed twice.
 */

export const JOB_WORKER_BUDGET_MS = 240_000;
export const JOB_LOCK_TTL_MS = 6 * 60 * 1000;
/** Do not pick up another job when less than this remains. One step needs the rest. */
export const JOB_MIN_CLAIM_REMAINING_MS = 90_000;
/** Leave time to store the model result after the call returns. */
const STEP_SAVE_MARGIN_MS = 15_000;
const MODEL_TIMEOUT_CAP_MS = 240_000;

export function shouldClaimAnotherJob(
  now: number,
  deadline: number,
  claimed: number,
  batchSize: number,
): boolean {
  if (claimed >= batchSize) return false;
  if (claimed === 0) return true;
  return now + JOB_MIN_CLAIM_REMAINING_MS < deadline;
}

/**
 * Milliseconds the model call may take, or null when the step should wait for a later tick.
 * `neededMs` is how long this kind of step usually takes; a short remainder must not start it.
 */
export function stepBudgetMs(now: number, deadline: number, neededMs: number): number | null {
  const remaining = deadline - now;
  if (remaining < neededMs) return null;
  const budget = Math.min(MODEL_TIMEOUT_CAP_MS, remaining - STEP_SAVE_MARGIN_MS);
  return budget >= 30_000 ? budget : null;
}
