import type { SupabaseClient } from "@supabase/supabase-js";

import { parseActionableRecommendation } from "@/lib/dt/seo/report-recommendations";

export async function syncSeoTasksFromReportRecommendations(
  supabase: SupabaseClient,
  reportId: string,
  organisationId: string,
  recommendations: unknown,
): Promise<{ inserted: number; skipped: boolean }> {
  if (!Array.isArray(recommendations)) {
    return { inserted: 0, skipped: false };
  }

  const { data: existing, error: existingError } = await supabase
    .from("dt_seo_tasks")
    .select("title")
    .eq("report_id", reportId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingTitles = new Set((existing ?? []).map((row) => row.title));

  const rows = recommendations.slice(0, 20).flatMap((item) => {
    const parsed = parseActionableRecommendation(item);
    if (!parsed || existingTitles.has(parsed.title)) return [];

    return [
      {
        organisation_id: organisationId,
        report_id: reportId,
        title: parsed.title.slice(0, 500),
        keyword: parsed.keyword?.slice(0, 200) ?? null,
        current_status: parsed.currentStatus?.slice(0, 500) ?? null,
        url: parsed.url?.slice(0, 2000) ?? null,
        action: parsed.action.slice(0, 2000),
        status: "open" as const,
      },
    ];
  });

  if (rows.length === 0) {
    return { inserted: 0, skipped: false };
  }

  const { error } = await supabase.from("dt_seo_tasks").insert(rows);
  if (error) {
    if (error.code === "23505") {
      return { inserted: 0, skipped: true };
    }
    throw new Error(error.message);
  }

  return { inserted: rows.length, skipped: false };
}
