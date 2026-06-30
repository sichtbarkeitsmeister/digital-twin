import { runDueJobs } from "@/lib/jobs/runner";

/**
 * Process due jobs in the current Next.js process. Called right after enqueue
 * so crawls/reports progress without waiting for pg_cron (which may target a
 * different deployment URL).
 */
export function kickJobsWorker(batchSize = 3): void {
  void runDueJobs({ batchSize }).catch((error) => {
    console.error("[jobs] kick failed", error);
  });
}
