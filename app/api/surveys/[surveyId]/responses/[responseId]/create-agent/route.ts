import { NextResponse } from "next/server";
import { z } from "zod";

import { createDtPersonaAgent } from "@/lib/dt/db";
import { ensureAvatarGlobalPromptAnchor } from "@/lib/dt/prompts/avatar-global-prompt-anchor";
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
  const avatarPart = ensureAvatarGlobalPromptAnchor(agent.prompt_template);
  if (!avatarPart.trim()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Avatar-Prompt ist leer — bitte die Vorschau neu erzeugen und erneut speichern.",
      },
      { status: 400 },
    );
  }

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

  // Guard against DB RPC drift (old dt_create_persona_agent ignored prompt_append).
  const { data: created } = await auth.supabase
    .from("dt_agents")
    .select("id,prompt_append,uses_global_prompt")
    .eq("id", agentId)
    .maybeSingle();

  const appendMissing = !String(created?.prompt_append ?? "").trim();
  const globalMissing = created?.uses_global_prompt !== true;

  if (appendMissing || globalMissing) {
    const { updateDtAgent } = await import("@/lib/dt/db");
    const repaired = await updateDtAgent({
      agentId,
      patch: {
        prompt_append: avatarPart,
        uses_global_prompt: true,
        prompt_template: `Avatar: ${agent.name}`,
      },
    });

    const { data: after } = await auth.supabase
      .from("dt_agents")
      .select("prompt_append,uses_global_prompt")
      .eq("id", agentId)
      .maybeSingle();

    if (
      !repaired.ok ||
      !String(after?.prompt_append ?? "").trim() ||
      after?.uses_global_prompt !== true
    ) {
      return NextResponse.json(
        {
          ok: false,
          agentId,
          message:
            "Agent angelegt, aber Avatar-Prompt wurde nicht gespeichert. Bitte in Supabase die Migration 20260811_survey_agent_prospect_orientation.sql ausführen (dt_create_persona_agent) und den Agenten erneut umwandeln.",
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, agentId });
}
