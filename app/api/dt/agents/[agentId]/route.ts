import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteDtAgent, requireAuthUser, updateDtAgent } from "@/lib/dt/db";
import { canDirectlyEditDtAgents } from "@/lib/dt/org-access";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().max(120).nullable().optional(),
  promptTemplate: z.string().max(32_000).optional(),
  promptAppend: z.string().max(32_000).nullable().optional(),
  usesGlobalPrompt: z.boolean().optional(),
  quickActions: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  isEnabled: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});

export async function GET(
  _: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data, error } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template,prompt_append,uses_global_prompt",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, agent: data });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data: existing } = await auth.supabase
    .from("dt_agents")
    .select("organisation_id")
    .eq("id", agentId)
    .maybeSingle();

  if (!existing?.organisation_id) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  const allowed = await canDirectlyEditDtAgents(auth.supabase, auth.userId);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Direkte Bearbeitung ist nur für Administratoren möglich. Bitte eine Änderungsanfrage senden.",
      },
      { status: 403 },
    );
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.promptTemplate !== undefined) patch.prompt_template = parsed.data.promptTemplate;
  if (parsed.data.promptAppend !== undefined) patch.prompt_append = parsed.data.promptAppend;
  if (parsed.data.usesGlobalPrompt !== undefined) {
    patch.uses_global_prompt = parsed.data.usesGlobalPrompt;
  }
  if (parsed.data.quickActions !== undefined) patch.quick_actions = parsed.data.quickActions;
  if (parsed.data.isEnabled !== undefined) patch.is_enabled = parsed.data.isEnabled;
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "Keine Änderungen übergeben." }, { status: 400 });
  }

  const updated = await updateDtAgent({ agentId, patch });
  if (!updated.ok) {
    return NextResponse.json(
      { ok: false, message: updated.error ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  const { data: agent } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template,prompt_append,uses_global_prompt",
    )
    .eq("id", agentId)
    .single();

  return NextResponse.json({ ok: true, agent });
}

function deleteAgentMessage(code: string | undefined): string {
  switch (code) {
    case "default_agent_protected":
      return "Standard-Agenten (DigitalTwin, SEO-Berater) können nicht entfernt werden.";
    case "last_enabled_agent":
      return "Mindestens ein aktiver Agent muss in der Organisation bleiben.";
    case "agent_has_chats":
      return "Agent hat noch Chats — zuerst deaktivieren oder Chats löschen.";
    case "agent_not_found":
      return "Agent nicht gefunden.";
    case "forbidden":
      return "Keine Berechtigung.";
    default:
      return "Agent konnte nicht gelöscht werden.";
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { agentId } = await context.params;
  const { data: existing } = await auth.supabase
    .from("dt_agents")
    .select("organisation_id")
    .eq("id", agentId)
    .maybeSingle();

  if (!existing?.organisation_id) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  const allowed = await canDirectlyEditDtAgents(auth.supabase, auth.userId);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: "Agenten können nur von Administratoren entfernt werden.",
      },
      { status: 403 },
    );
  }

  const deleted = await deleteDtAgent(agentId);
  if (!deleted.ok) {
    const code = deleted.error?.includes("default_agent_protected")
      ? "default_agent_protected"
      : deleted.error?.includes("last_enabled_agent")
        ? "last_enabled_agent"
        : deleted.error?.includes("agent_has_chats")
          ? "agent_has_chats"
          : deleted.error?.includes("agent_not_found")
            ? "agent_not_found"
            : deleted.error?.includes("forbidden")
              ? "forbidden"
              : undefined;
    return NextResponse.json(
      { ok: false, message: deleteAgentMessage(code) },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
