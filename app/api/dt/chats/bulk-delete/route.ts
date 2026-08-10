import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { deleteDtChatsBulk } from "@/lib/dt/delete-chats-bulk";
import { canDirectlyEditDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
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
    return NextResponse.json({ ok: false, message: "Ungültige Parameter." }, { status: 400 });
  }

  const { organisationId, agentId, mode } = parsed.data;
  const platformAdmin = await isPlatformAdmin(auth.supabase, auth.userId);

  if (agentId) {
    // Clearing chats so an agent can be removed — platform admins only.
    if (!(await canDirectlyEditDtAgents(auth.supabase, auth.userId))) {
      return NextResponse.json(
        { ok: false, message: "Chats eines Agenten können nur von Administratoren gelöscht werden." },
        { status: 403 },
      );
    }
  } else if (mode === "seo") {
    const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
    }
  } else if (!platformAdmin) {
    // Non-admins may only wipe their own personal chats in the org.
    const result = await deleteDtChatsBulk({
      supabase: auth.supabase,
      organisationId,
      mode: mode ?? "default",
      ownerUserId: auth.userId,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deletedCount: result.deletedCount });
  }

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
