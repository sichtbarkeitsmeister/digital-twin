import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { loadDtSeoTaskAssignees } from "@/lib/dt/seo/task-assignees";

const querySchema = z.object({
  org: z.string().uuid(),
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

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId!, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  try {
    const assignees = await loadDtSeoTaskAssignees();
    return NextResponse.json({ ok: true, assignees });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Zuweisbare Admins konnten nicht geladen werden.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
