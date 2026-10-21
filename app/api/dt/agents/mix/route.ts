import { NextResponse } from "next/server";
import { z } from "zod";

import { MIX_SOURCES_MAX, MIX_SOURCES_MIN } from "@/lib/dt/agents/mix";
import {
  MIX_AGENT_SELECT,
  MIX_USAGE_MODE,
  mixRuleFailureMessage,
  saveMixAgent,
  selectMixSources,
  type MixAgentRow,
} from "@/lib/dt/agents/mix-generator";
import { loadMixPrompt } from "@/lib/dt/agents/mix-prompt-db";
import { requireAuthUser } from "@/lib/dt/db";
import { canDirectlyEditDtAgents, canManageDtAgents } from "@/lib/dt/org-access";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { generateCheckedMix, workshopFailureMessage } from "@/lib/dt/transcripts/workshop-llm";

export const maxDuration = 300;

/** The second run of the generator only starts this early, so it can finish within the limit. */
const MIX_RETRY_DEADLINE_MS = 150_000;

const bodySchema = z.object(
  {
    organisationId: z.string().uuid("Ungültige Organisation."),
    sourceAgentIds: z
      .array(z.string().uuid("Ungültige Avatar-ID."), "Bitte Zielgruppen-Avatare auswählen.")
      .min(MIX_SOURCES_MIN, "Mindestens zwei Zielgruppen-Avatare auswählen.")
      .max(MIX_SOURCES_MAX, `Höchstens ${MIX_SOURCES_MAX} Zielgruppen-Avatare auswählen.`),
  },
  "Ungültige Eingabe.",
);

/**
 * Agenten → „Mix-Agent erstellen“ / „Mix neu erstellen“: builds the organisation's Mix from the
 * selected Zielgruppen avatars with the „Mix-Avatar“ prompt, checks it and creates the Mix or
 * updates it in place. Nothing is saved while the result breaks a rule.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const { organisationId } = parsed.data;

  // Same check as „Neuer Agent“ (POST /api/dt/agents).
  if (!(await canDirectlyEditDtAgents(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung zum Anlegen von Agenten." },
      { status: 403 },
    );
  }
  if (!(await canManageDtAgents(auth.supabase, auth.userId, organisationId))) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung für diese Organisation." },
      { status: 403 },
    );
  }

  // Taken before the sources are read: a source changed after it marks the Mix as outdated.
  const generatedAt = new Date().toISOString();
  const { data: rows, error: agentsError } = await auth.supabase
    .from("dt_agents")
    .select(MIX_AGENT_SELECT)
    .eq("organisation_id", organisationId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (agentsError) {
    return NextResponse.json({ ok: false, message: agentsError.message }, { status: 500 });
  }
  const selection = selectMixSources((rows ?? []) as MixAgentRow[], parsed.data.sourceAgentIds);
  if (!selection.ok) {
    return NextResponse.json({ ok: false, message: selection.message }, { status: 400 });
  }

  try {
    const { data: org } = await auth.supabase
      .from("organisations")
      .select("name")
      .eq("id", organisationId)
      .maybeSingle();
    const system = await loadMixPrompt(org?.name?.trim() || "Organisation");
    const generated = await generateCheckedMix({
      system,
      sources: selection.sources,
      deadline: startedAt + MIX_RETRY_DEADLINE_MS,
    });
    const saved =
      generated.errors.length === 0
        ? await saveMixAgent({
            supabase: auth.supabase,
            organisationId,
            existing: selection.mix,
            result: generated.result,
            sources: selection.sources,
            generatedAt,
          })
        : null;
    await recordLlmUsageEvent(auth.supabase, {
      organisationId,
      userId: auth.userId,
      agentId: saved?.ok ? saved.agentId : (selection.mix?.id ?? null),
      mode: MIX_USAGE_MODE,
      via: "direct",
      model: generated.model,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
    });
    if (!saved) {
      return NextResponse.json(
        { ok: false, message: mixRuleFailureMessage(generated.errors), errors: generated.errors },
        { status: 422 },
      );
    }
    if (!saved.ok) {
      return NextResponse.json({ ok: false, message: saved.message }, { status: 500 });
    }

    const { data: agent } = await auth.supabase
      .from("dt_agents")
      .select(
        "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template,prompt_append,uses_global_prompt,is_default,avatar_data,updated_at",
      )
      .eq("id", saved.agentId)
      .maybeSingle();
    return NextResponse.json({ ok: true, created: saved.created, agentId: saved.agentId, agent });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: workshopFailureMessage(err, "Der Mix konnte nicht erstellt werden.") },
      { status: 500 },
    );
  }
}
