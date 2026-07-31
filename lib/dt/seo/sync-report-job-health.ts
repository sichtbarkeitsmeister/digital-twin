import { createServiceClient } from "@/lib/supabase/service";

/** Report still queued without n8n mark-running. */
const QUEUED_STALE_MS = 10 * 60_000;
/** Report marked running but never completed/errored. */
const RUNNING_STALE_MS = 60 * 60_000;

/**
 * If a SEO report stays queued/running without n8n completion, mark it as
 * error so the UI does not spin forever.
 */
export async function syncReportJobHealth(input?: {
  organisationId?: string;
  reportId?: string;
}): Promise<void> {
  const supabase = createServiceClient();

  let query = supabase
    .from("dt_seo_reports")
    .select("id,organisation_id,state,created_at,started_at,updated_at")
    .in("state", ["queued", "running"]);

  if (input?.organisationId) {
    query = query.eq("organisation_id", input.organisationId);
  }
  if (input?.reportId) {
    query = query.eq("id", input.reportId);
  }

  const { data: reports } = await query.limit(50);
  if (!reports?.length) return;

  const now = Date.now();

  for (const report of reports) {
    if (report.state === "queued") {
      const ageMs = now - new Date(report.created_at).getTime();
      if (ageMs <= QUEUED_STALE_MS) continue;
      await supabase
        .from("dt_seo_reports")
        .update({
          state: "error",
          state_message:
            "Fehler: Report wurde nicht gestartet (n8n-Workflow hat nicht geantwortet). Bitte erneut versuchen.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", report.id)
        .eq("state", "queued");
      continue;
    }

    if (report.state === "running") {
      const startedAt = report.started_at ?? report.updated_at ?? report.created_at;
      const ageMs = now - new Date(startedAt).getTime();
      if (ageMs <= RUNNING_STALE_MS) continue;
      await supabase
        .from("dt_seo_reports")
        .update({
          state: "error",
          state_message:
            "Fehler: Report-Erstellung abgebrochen (Zeitüberschreitung). Bitte erneut versuchen oder n8n prüfen.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", report.id)
        .eq("state", "running");
    }
  }
}
