import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { isMemberOfOrganisation } from "@/lib/dashboard/org-context";
import { loadSurveyExamQuestionsForResponse } from "@/lib/dt/load-survey-exam-questions";

/**
 * Interviewer script for probing a survey-built persona in the main DT chat.
 * Available when the agent has survey lineage; gated by org membership.
 */
export async function GET(
  _: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data: agent, error } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,source_survey_id,source_survey_response_id,is_enabled",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (error || !agent) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  const member = await isMemberOfOrganisation(
    auth.supabase,
    auth.userId,
    agent.organisation_id as string,
  );
  if (!member) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }

  const surveyId = agent.source_survey_id as string | null;
  const responseId = agent.source_survey_response_id as string | null;

  if (!surveyId || !responseId) {
    return NextResponse.json({
      ok: true,
      available: false,
      surveyTitle: null,
      factCount: 0,
      questions: [],
    });
  }

  const loaded = await loadSurveyExamQuestionsForResponse(surveyId, responseId);
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, message: loaded.message },
      { status: loaded.status },
    );
  }

  return NextResponse.json({
    ok: true,
    available: true,
    surveyTitle: loaded.surveyTitle,
    factCount: loaded.factCount,
    questions: loaded.questions,
  });
}
