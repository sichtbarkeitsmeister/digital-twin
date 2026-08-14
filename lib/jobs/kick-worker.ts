import { after } from "next/server";

import { runDueJobs } from "@/lib/jobs/runner";

/**
 * Process due jobs after the current request finishes (when possible).
 * Without `after()`, Vercel may freeze the isolate as soon as the HTTP
 * response is sent — crawls then die mid-chunk with URLs stuck in
 * `processing`.
 */
export function kickJobsWorker(batchSize = 3): void {
  const run = () =>
    runDueJobs({ batchSize }).catch((error) => {
      console.error("[jobs] kick failed", error);
    });

  try {
    after(run);
  } catch {
    // Not in a Next.js request context (e.g. nested kick from a job handler).
    void run();
  }
}
