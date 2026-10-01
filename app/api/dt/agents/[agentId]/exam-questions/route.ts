import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { isMemberOfOrganisation } from "@/lib/dashboard/org-context";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { loadSurveyExamQuestionsForResponse } from "@/lib/dt/load-survey-exam-questions";
import {
  chooseExamQuestionBank,
  loadPersonaConfigExamQuestions,
} from "@/lib/dt/persona-config-exam";
import {
  persistInferredExamSource,
  resolveAgentExamSource,
} from "@/lib/dt/resolve-agent-exam-source";
import type { SurveyExamAudience, SurveyExamQuestion } from "@/lib/dt/survey-exam-questions";

export const maxDuration = 30;

function audienceForAgentKind(kind: string | null | undefined): SurveyExamAudience {
  if (kind === "seo_advisor") return "company";
  return "persona";
}

/**
 * Interviewer script for the persona/company test.
 * Completed questionnaires win. Otherwise the model reads the twin's own
 * settings (DISG, pain points, decision criteria, Hormozi) and the rail
 * checks the answer against that SOLL.
 */
export async function GET(
  _: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }

  const { agentId } = await context.params;
  const { data: agent, error } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,name,role,kind,source_survey_id,source_survey_response_id,is_enabled,prompt_template,prompt_append,avatar_data,uses_global_prompt",
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

  let surveyQuestions: SurveyExamQuestion[] | null = null;
  let surveyTitle: string | null = null;
  let surveyAudience = audience;
  if (source) {
    const loaded = await loadSurveyExamQuestionsForResponse(source.surveyId, source.responseId, {
      audience,
    });
    if (loaded.ok && loaded.questions.length > 0) {
      surveyQuestions = loaded.questions;
      surveyTitle = loaded.surveyTitle;
      surveyAudience = loaded.audience;
      if (source.inferred) {
        void persistInferredExamSource({
          agentId: agent.id as string,
          surveyId: source.surveyId,
          responseId: source.responseId,
        });
      }
    }
  }

  if (surveyQuestions && surveyQuestions.length > 0) {
    return NextResponse.json({
      ok: true,
      available: true,
      audience: surveyAudience,
      questionSource: "survey",
      surveyTitle,
      factCount: surveyQuestions.length,
      questions: surveyQuestions,
    });
  }

  let personaQuestions: SurveyExamQuestion[] = [];
  try {
    const loadedPersona = await loadPersonaConfigExamQuestions({
      name: agent.name as string | null,
      role: agent.role as string | null,
      audience,
      promptTemplate: agent.prompt_template as string | null,
      promptAppend: agent.prompt_append as string | null,
      avatarData: agent.avatar_data,
      usesGlobalPrompt: Boolean(agent.uses_global_prompt),
    });
    personaQuestions = loadedPersona.questions;
  } catch (error) {
    console.warn(
      "[dt] persona config exam questions failed",
      error instanceof Error ? error.message : error,
    );
  }

  const chosen = chooseExamQuestionBank({
    surveyQuestions,
    personaQuestions,
  });

  return NextResponse.json({
    ok: true,
    available: chosen.questions.length > 0,
    audience,
    questionSource: chosen.questionSource,
    surveyTitle: null,
    factCount: chosen.questions.length,
    questions: chosen.questions,
  });
}
