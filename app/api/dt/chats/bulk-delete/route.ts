import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { deleteDtChatsBulk } from "@/lib/dt/delete-chats-bulk";
import { canDirectlyEditDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** Required: only chats of this agent are deleted. */
  agentId: z.string().uuid(),
  mode: z.enum(["default", "seo", "team"]).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ungültiger Body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Ungültige Parameter — agentId ist erforderlich." },
      { status: 400 },
    );
  }

  const { organisationId, agentId, mode } = parsed.data;
  const platformAdmin = await isPlatformAdmin(auth.supabase, auth.userId);

  if (mode === "seo") {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  }

  if (platformAdmin || (await canDirectlyEditDtAgents(auth.supabase, auth.userId))) {
    const result = await deleteDtChatsBulk({
      supabase: auth.supabase,
      organisationId,
      agentId,
      mode,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deletedCount: result.deletedCount });
  }

  // Non-admins: only their own chats with this agent.
  if (mode === "seo") {
    return NextResponse.json(
      { ok: false, message: "Keine Berechtigung, SEO-Chats zu löschen." },
      { status: 403 },
    );
  }

  const result = await deleteDtChatsBulk({
    supabase: auth.supabase,
    organisationId,
    agentId,
    mode: mode ?? "default",
    ownerUserId: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedCount: result.deletedCount });
}
