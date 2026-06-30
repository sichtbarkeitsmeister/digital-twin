import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { loadOrgMembersForOversight } from "@/lib/dt/oversight";

const querySchema = z.object({
  org: z.string().uuid(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const members = await loadOrgMembersForOversight(parsed.data.org);
  return NextResponse.json({ ok: true, members });
}
