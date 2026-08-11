import { NextResponse } from "next/server";
import { z } from "zod";

import { createDtPersonaAgent } from "@/lib/dt/db";
import {
  loadSurveyResponseBundle,
  mapPersonaAgentRpcError,
} from "@/lib/dt/survey-to-agent-service";
import { surveyAgentPreviewSchema } from "@/lib/dt/survey-to-agent-prompt";
import { canManageDtAgents } from "@/lib/dt/org-access";
import { requireSurveyPlatformAdmin } from "@/lib/surveys/platform-admin";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agent: surveyAgentPreviewSchema,
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

  const bundle = await loadSurveyResponseBundle(surveyId, responseId);
  if (!bundle.ok) {
    return NextResponse.json(
      { ok: false, message: bundle.message },
      { status: bundle.status },
    );
  }

  if (bundle.existingAgent) {
    return NextResponse.json(
      {
        ok: false,
        message: "Für diese Antwort existiert bereits ein Agent.",
        agentId: bundle.existingAgent.id,
      },
      { status: 409 },
    );
  }

  const agent = parsed.data.agent;
  const avatarPart = agent.prompt_template.trim();
  const { agentId, error } = await createDtPersonaAgent({
    organisationId: parsed.data.organisationId,
    payload: {
      name: agent.name,
      role: agent.role,
      slug: agent.slug,
      // Stub kept for UI/fallback; live rules come from global DigitalTwin prompt.
      prompt_template: `Avatar: ${agent.name}`,
      prompt_append: avatarPart,
      uses_global_prompt: true,
      avatar_data: agent.avatar_data,
      quick_actions: agent.quick_actions ?? [],
      source_survey_id: surveyId,
      source_survey_response_id: responseId,
      is_enabled: true,
    },
  });

  if (!agentId) {
    return NextResponse.json(
      { ok: false, message: mapPersonaAgentRpcError(error) },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, agentId });
}
