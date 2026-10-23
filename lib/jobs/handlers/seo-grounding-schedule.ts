import { startGroundingCheck } from "@/lib/dt/seo/grounding-check/actions";
import { findDueGroundingChecks, scheduledRunAfter } from "@/lib/dt/seo/grounding-check/schedule";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobHandler } from "../types";

/**
 * Daily sweep (kind: seo.grounding_schedule), queued by pg_cron (dt_grounding_schedule_daily).
 * Queues one scheduled Grounding check per organisation whose page is due soon, overdue or
 * missing and that has no open run. No e-mail: drafts only appear in the Grounding tab.
 */
export const seoGroundingScheduleHandler: JobHandler = async () => {
  const service = createServiceClient();
  const now = new Date();
  let due;
  try {
    due = await findDueGroundingChecks(service, now);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryable: true };
  }

  const queued: Array<{ organisationId: string; runId: string; reason: string }> = [];
  const skipped: Array<{ organisationId: string; message: string }> = [];
  for (const [index, candidate] of due.entries()) {
    const started = await startGroundingCheck(service, {
      organisationId: candidate.organisationId,
      trigger: "schedule",
      userId: null,
      runAfter: scheduledRunAfter(index, now),
    });
    if (started.ok) queued.push({ organisationId: candidate.organisationId, runId: started.value.id, reason: candidate.reason });
    else skipped.push({ organisationId: candidate.organisationId, message: started.message });
  }
  return { ok: true, result: { considered: due.length, queued, skipped } };
};
