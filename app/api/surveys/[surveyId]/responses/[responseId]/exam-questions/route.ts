import { NextResponse } from "next/server";

import { extractSurveyFacts } from "@/lib/dt/survey-facts";
import { buildSurveyExamQuestions } from "@/lib/dt/survey-exam-questions";
import { loadSurveyResponseBundle } from "@/lib/dt/survey-to-agent-service";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

/**
 * Interviewer script for probing a survey→avatar preview.
 * Deterministic from answered questionnaire fields (no LLM).
 */
export async function GET(
  _: Request,
  context: { params: Promise<{ surveyId: string; responseId: string }> },
) {
  const auth = await requireSurveyPlatformAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: auth.message },
      { status: auth.message.includes("angemeldet") ? 401 : 403 },
    );
  }

  const { surveyId, responseId } = await context.params;
  const bundle = await loadSurveyResponseBundle(surveyId, responseId);
  if (!bundle.ok) {
    return NextResponse.json(
      { ok: false, message: bundle.message },
      { status: bundle.status },
    );
  }

  const facts = extractSurveyFacts({
    surveyTitle: bundle.survey.title,
    definition: bundle.survey.definition,
    answers: (bundle.response.answers ?? {}) as Record<string, unknown>,
    fieldQuestions: bundle.fieldQuestions,
  });

  const questions = buildSurveyExamQuestions(facts.facts);

  return NextResponse.json({
    ok: true,
    surveyTitle: facts.surveyTitle,
    factCount: facts.facts.length,
    questions,
  });
}
