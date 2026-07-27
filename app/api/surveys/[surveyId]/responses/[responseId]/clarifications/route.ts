import { NextResponse } from "next/server";

import { loadClarificationsForSurveyResponse } from "@/lib/dt/survey-clarifications";
import { loadSurveyResponseBundle } from "@/lib/dt/survey-to-agent-service";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

export const maxDuration = 30;

/**
 * Detect ambiguous remarks / cross-refs before avatar generation.
 * Admin reviews these in the wizard (Freigabe) before the expensive batch starts.
 */
export async function GET(
  req: Request,
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
  const organisationId = new URL(req.url).searchParams.get("organisationId")?.trim() ?? "";
  if (!organisationId) {
    return NextResponse.json(
      { ok: false, message: "organisationId fehlt." },
      { status: 400 },
    );
  }

  const bundle = await loadSurveyResponseBundle(surveyId, responseId);
  if (!bundle.ok) {
    return NextResponse.json(
      { ok: false, message: bundle.message },
      { status: bundle.status },
    );
  }

  const loaded = await loadClarificationsForSurveyResponse({
    surveyId,
    responseId,
    organisationId,
    definition: bundle.survey.definition,
    fieldQuestions: bundle.fieldQuestions,
    answers:
      bundle.response.answers &&
      typeof bundle.response.answers === "object" &&
      !Array.isArray(bundle.response.answers)
        ? (bundle.response.answers as Record<string, unknown>)
        : {},
  });

  return NextResponse.json({
    ok: true,
    clarifications: loaded.clarifications,
    sources: loaded.sources,
    anbieterSources: loaded.anbieterSources,
    previews: loaded.previews,
  });
}
