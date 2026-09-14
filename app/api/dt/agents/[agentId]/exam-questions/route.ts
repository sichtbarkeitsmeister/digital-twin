import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { isMemberOfOrganisation } from "@/lib/dashboard/org-context";
import { loadSurveyExamQuestionsForResponse } from "@/lib/dt/load-survey-exam-questions";
import {
  persistInferredExamSource,
  resolveAgentExamSource,
} from "@/lib/dt/resolve-agent-exam-source";
import type { SurveyExamAudience } from "@/lib/dt/survey-exam-questions";

function audienceForAgentKind(kind: string | null | undefined): SurveyExamAudience {
  if (kind === "seo_advisor") return "company";
  return "persona";
}

/**
 * Interviewer script for probing a survey-built agent in the main DT chat.
 * Persona agents get Wunschkunde (du) probes; SEO advisors get company probes.
 * If source_survey_* is missing, we still look up the org questionnaire.
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
      "id,organisation_id,name,role,kind,source_survey_id,source_survey_response_id,is_enabled",
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

  const audience = audienceForAgentKind(agent.kind as string);
  const source = await resolveAgentExamSource({
    organisationId: agent.organisation_id as string,
    agentId: agent.id as string,
    agentKind: agent.kind as string | null,
    agentName: agent.name as string | null,
    agentRole: agent.role as string | null,
    sourceSurveyId: agent.source_survey_id as string | null,
    sourceResponseId: agent.source_survey_response_id as string | null,
  });

  if (!source) {
    return NextResponse.json({
      ok: true,
      available: false,
      audience,
      surveyTitle: null,
      factCount: 0,
      questions: [],
    });
  }

  const loaded = await loadSurveyExamQuestionsForResponse(source.surveyId, source.responseId, {
    audience,
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, message: loaded.message },
      { status: loaded.status },
    );
  }

  if (source.inferred && loaded.questions.length > 0) {
    void persistInferredExamSource({
      agentId: agent.id as string,
      surveyId: source.surveyId,
      responseId: source.responseId,
    });
  }

  return NextResponse.json({
    ok: true,
    available: true,
    audience: loaded.audience,
    surveyTitle: loaded.surveyTitle,
    factCount: loaded.factCount,
    questions: loaded.questions,
  });
}
