import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyAnbieterSurveyToSeoAgent,
  previewAnbieterSurveyForSeo,
} from "@/lib/dt/anbieter-to-seo";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["preview", "apply"]).default("preview"),
});

export async function POST(
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
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();

    if (parsed.data.action === "apply") {
      const result = await applyAnbieterSurveyToSeoAgent({
        surveyId,
        responseId,
        organisationId: parsed.data.organisationId,
        supabase,
      });
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, message: result.message },
          { status: result.status },
        );
      }
      return NextResponse.json({
        ok: true,
        action: "apply",
        agentId: result.agentId,
        organisationId: result.organisationId,
        organisationName: result.organisationName,
        knowledgeBody: result.knowledgeBody,
      });
    }

    const result = await previewAnbieterSurveyForSeo({
      surveyId,
      responseId,
      organisationId: parsed.data.organisationId,
      supabase,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      action: "preview",
      organisationId: result.organisationId,
      organisationName: result.organisationName,
      knowledgeBody: result.knowledgeBody,
      seoAgentId: result.seoAgentId,
      seoAgentName: result.seoAgentName,
    });
  } catch (err) {
    console.error("[dt] apply-to-seo failed", err);
    const message = err instanceof Error ? err.message : "Übernahme fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
