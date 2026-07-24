import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyAgentRefinementFromSurvey,
  mapPersonaAgentRpcError,
} from "@/lib/dt/survey-to-agent-service";
import { canManageDtAgents } from "@/lib/dt/org-access";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agentId: z.string().uuid(),
  promptTemplate: z.string().min(200).max(120_000),
});

export const maxDuration = 800;

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

  const allowed = await canManageDtAgents(
    auth.supabase,
    auth.userId!,
    parsed.data.organisationId,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung für diese Organisation." },
      { status: 403 },
    );
  }

  try {
    const result = await applyAgentRefinementFromSurvey({
      surveyId,
      responseId,
      organisationId: parsed.data.organisationId,
      agentId: parsed.data.agentId,
      promptTemplate: parsed.data.promptTemplate,
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

    return NextResponse.json({ ok: true, agentId: result.agentId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Agent konnte nicht aktualisiert werden.";
    return NextResponse.json(
      { ok: false, message: mapPersonaAgentRpcError(message) },
      { status: 500 },
    );
  }
}
