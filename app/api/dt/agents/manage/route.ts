import { NextResponse } from "next/server";
import { z } from "zod";

import { loadAgentsForOrgManage, requireAuthUser } from "@/lib/dt/db";
import { canDirectlyEditDtAgents, canManageDtAgents } from "@/lib/dt/org-access";

const querySchema = z.object({
  org: z.string().uuid(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const allowed = await canManageDtAgents(
    auth.supabase,
    auth.userId,
    parsed.data.org,
  );
  if (!allowed) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const agents = await loadAgentsForOrgManage(parsed.data.org);
  const canDirectlyEdit = await canDirectlyEditDtAgents(auth.supabase, auth.userId);
  return NextResponse.json({ ok: true, agents, canDirectlyEdit });
}
