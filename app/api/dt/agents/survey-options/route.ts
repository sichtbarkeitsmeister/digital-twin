import { NextResponse } from "next/server";

import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";
import { createServiceClient } from "@/lib/supabase/service";

export type SurveyAgentOption = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  completedAt: string | null;
};

export async function GET() {
  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: auth.message },
      { status: auth.message.includes("angemeldet") ? 401 : 403 },
    );
  }

  const supabase = createServiceClient();

  const { data: usedRows } = await supabase
    .from("dt_agents")
    .select("source_survey_response_id")
    .not("source_survey_response_id", "is", null);

  const usedResponseIds = new Set(
    (usedRows ?? [])
      .map((r) => r.source_survey_response_id)
      .filter((id): id is string => typeof id === "string"),
  );

  const { data: responses, error } = await supabase
    .from("survey_responses")
    .select("id, survey_id, status, completed_at, surveys!inner(id, title, deleted_at, purpose)")
    .eq("status", "completed")
    .is("surveys.deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const options: SurveyAgentOption[] = [];

  for (const row of responses ?? []) {
    if (usedResponseIds.has(row.id)) continue;

    const survey = row.surveys as
      | { id: string; title: string; purpose?: string }
      | { id: string; title: string; purpose?: string }[];
    const surveyData = Array.isArray(survey) ? survey[0] : survey;
    if (!surveyData?.title) continue;
    // Persona avatar flow only — Anbieter surveys go to SEO knowledge.
    if (surveyData.purpose === "anbieter" || surveyData.purpose === "intern") continue;

    options.push({
      surveyId: row.survey_id,
      responseId: row.id,
      surveyTitle: surveyData.title,
      completedAt: row.completed_at ?? null,
    });
  }

  return NextResponse.json({ ok: true, options });
}
