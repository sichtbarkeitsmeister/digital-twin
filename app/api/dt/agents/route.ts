import { NextResponse } from "next/server";
import { z } from "zod";

import { createDtPersonaAgent, loadAgentsForOrg, requireAuthUser } from "@/lib/dt/db";
import { filterAgentsHiddenFromOrgMembers } from "@/lib/dt/agents/seo-advisor";
import { canDirectlyEditDtAgents, canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { mapPersonaAgentRpcError } from "@/lib/dt/survey-to-agent-service";

const querySchema = z.object({
  org: z.string().uuid(),
});

const createSchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9_]+$/, "Slug nur Kleinbuchstaben, Ziffern und Unterstrich."),
  prompt: z.string().trim().min(1).max(32_000),
  quickActions: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const agents = await loadAgentsForOrg(parsed.data.org);
  const platformAdmin = await isPlatformAdmin(auth.supabase, auth.userId!);
  const visibleAgents = platformAdmin ? agents : filterAgentsHiddenFromOrgMembers(agents);
  return NextResponse.json({ ok: true, agents: visibleAgents });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const allowedEdit = await canDirectlyEditDtAgents(auth.supabase, auth.userId);
  if (!allowedEdit) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung zum Anlegen von Agenten." },
      { status: 403 },
    );
  }

  const allowedOrg = await canManageDtAgents(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!allowedOrg) {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung für diese Organisation." },
      { status: 403 },
    );
  }

  const { agentId, error } = await createDtPersonaAgent({
    organisationId: parsed.data.organisationId,
    payload: {
      name: parsed.data.name,
      role: parsed.data.role ?? null,
      slug: parsed.data.slug,
      prompt_template: parsed.data.prompt,
      avatar_data: {},
      quick_actions: parsed.data.quickActions ?? [],
      is_enabled: true,
    },
  });

  if (!agentId) {
    return NextResponse.json(
      { ok: false, message: mapPersonaAgentRpcError(error) },
      { status: 400 },
    );
  }

  const { data: agent } = await auth.supabase
    .from("dt_agents")
    .select(
      "id,organisation_id,template_id,slug,name,role,kind,quick_actions,is_enabled,position,prompt_template,prompt_append,uses_global_prompt,is_default",
    )
    .eq("id", agentId)
    .single();

  return NextResponse.json({ ok: true, agentId, agent });
}
