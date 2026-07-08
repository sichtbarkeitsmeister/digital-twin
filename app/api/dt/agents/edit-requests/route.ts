import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildAgentProposedChanges,
  createDtAgentEditRequest,
  listDtAgentEditRequestsForOrg,
  listPendingDtAgentEditRequests,
} from "@/lib/dt/agent-edit-requests";
import { isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import { requireAuthUser } from "@/lib/dt/db";
import { canDirectlyEditDtAgents, canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { parseQuickActions } from "@/lib/dt/types";

const querySchema = z.object({
  org: z.string().uuid().optional(),
  pending: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120).nullable(),
  promptTemplate: z.string().max(32_000),
  quickActions: z.array(z.string().trim().min(1).max(200)).max(12),
  isEnabled: z.boolean(),
  position: z.number().int().min(0).max(999),
  requestNote: z.string().trim().max(2000).optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    org: url.searchParams.get("org") ?? undefined,
    pending: url.searchParams.get("pending") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Parameter." }, { status: 400 });
  }

  if (parsed.data.pending) {
    if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
      return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
    }
    const requests = await listPendingDtAgentEditRequests(auth.supabase);
    return NextResponse.json({ ok: true, requests });
  }

  if (!parsed.data.org) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const allowed = await canManageDtAgents(auth.supabase, auth.userId, parsed.data.org);
  if (!allowed) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const requests = await listDtAgentEditRequestsForOrg(auth.supabase, parsed.data.org);
  if (await isPlatformAdmin(auth.supabase, auth.userId)) {
    return NextResponse.json({ ok: true, requests });
  }

  const { data: orgAgents } = await auth.supabase
    .from("dt_agents")
    .select("id,slug,kind")
    .eq("organisation_id", parsed.data.org);
  const hiddenAgentIds = new Set(
    (orgAgents ?? []).filter(isSeoAdvisorAgent).map((agent) => agent.id),
  );
  return NextResponse.json({
    ok: true,
    requests: requests.filter((request) => !hiddenAgentIds.has(request.agent_id)),
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (await canDirectlyEditDtAgents(auth.supabase, auth.userId)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Als Administrator können Sie Agenten direkt bearbeiten — keine Anfrage nötig.",
      },
      { status: 400 },
    );
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

  const { data: agent } = await auth.supabase
    .from("dt_agents")
    .select("id,organisation_id,slug,kind,name,role,prompt_template,quick_actions,is_enabled,position")
    .eq("id", parsed.data.agentId)
    .maybeSingle();

  if (!agent || agent.organisation_id !== parsed.data.organisationId) {
    return NextResponse.json({ ok: false, message: "Agent nicht gefunden." }, { status: 404 });
  }

  if (isSeoAdvisorAgent(agent)) {
    return NextResponse.json(
      { ok: false, message: "Der SEO-Berater kann nur von Administratoren bearbeitet werden." },
      { status: 403 },
    );
  }

  const proposedChanges = buildAgentProposedChanges({
    current: {
      name: agent.name,
      role: agent.role,
      prompt_template: agent.prompt_template,
      quick_actions: parseQuickActions(agent.quick_actions),
      is_enabled: agent.is_enabled,
      position: agent.position,
    },
    next: {
      name: parsed.data.name,
      role: parsed.data.role,
      prompt_template: parsed.data.promptTemplate,
      quick_actions: parsed.data.quickActions,
      is_enabled: parsed.data.isEnabled,
      position: parsed.data.position,
    },
  });

  if (!proposedChanges) {
    return NextResponse.json(
      { ok: false, message: "Keine Änderungen gegenüber dem aktuellen Stand." },
      { status: 400 },
    );
  }

  const { request, error } = await createDtAgentEditRequest({
    supabase: auth.supabase,
    organisationId: parsed.data.organisationId,
    agentId: parsed.data.agentId,
    userId: auth.userId,
    proposedChanges,
    requestNote: parsed.data.requestNote,
  });

  if (error || !request) {
    return NextResponse.json(
      { ok: false, message: error ?? "Anfrage konnte nicht gesendet werden." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    request,
    message: "Änderungsanfrage gesendet — wir prüfen sie in Kürze.",
  });
}
