import { NextResponse } from "next/server";
import { z } from "zod";

import { generateAgentPreviewFromSurvey } from "@/lib/dt/survey-to-agent-service";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  extraRules: z.string().max(4000).optional(),
});

export async function POST(
  _req: Request,
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
  const parsed = bodySchema.safeParse(await _req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    const result = await generateAgentPreviewFromSurvey({
      surveyId,
      responseId,
      organisationId: parsed.data.organisationId,
      extraRules: parsed.data.extraRules,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: result.message,
          existingAgentId: "existingAgentId" in result ? result.existingAgentId : undefined,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      preview: result.preview,
      organisationId: result.organisationId,
      organisationName: result.organisationName,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Generierung fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
