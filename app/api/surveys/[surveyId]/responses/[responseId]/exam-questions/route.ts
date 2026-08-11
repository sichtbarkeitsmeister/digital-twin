import { NextResponse } from "next/server";

import { loadSurveyExamQuestionsForResponse } from "@/lib/dt/load-survey-exam-questions";
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
  const loaded = await loadSurveyExamQuestionsForResponse(surveyId, responseId, {
    audience: "persona",
  });
  if (!loaded.ok) {
    return NextResponse.json(
      { ok: false, message: loaded.message },
      { status: loaded.status },
    );
  }

  return NextResponse.json({
    ok: true,
    audience: loaded.audience,
    surveyTitle: loaded.surveyTitle,
    factCount: loaded.factCount,
    questions: loaded.questions,
  });
}
