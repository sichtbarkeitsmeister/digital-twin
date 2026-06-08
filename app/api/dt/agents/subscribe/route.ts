import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageDtAgents } from "@/lib/dt/org-access";
import { subscribeDtAgentTemplate, requireAuthUser } from "@/lib/dt/db";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  templateId: z.string().uuid(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
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

  const allowed = await canManageDtAgents(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!allowed) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const { agentId, error } = await subscribeDtAgentTemplate({
    organisationId: parsed.data.organisationId,
    templateId: parsed.data.templateId,
    overrides: parsed.data.overrides,
  });

  if (!agentId) {
    const message =
      error === "agent_slug_exists"
        ? "Dieser Agent ist für die Organisation bereits vorhanden."
        : (error ?? "Abonnement fehlgeschlagen.");
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  const { data: agent } = await auth.supabase
    .from("dt_agents")
    .select("id,organisation_id,slug,name,role,kind,quick_actions,is_enabled,position")
    .eq("id", agentId)
    .single();

  return NextResponse.json({ ok: true, agent });
}
