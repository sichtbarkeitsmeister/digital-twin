import { NextResponse } from "next/server";
import { z } from "zod";

import {
  countUnreviewedCompanyProfileEdits,
  listCompanyProfileEditsForOrg,
  listUnreviewedCompanyProfileEdits,
  markCompanyProfileEditReviewed,
} from "@/lib/dt/company-profile";
import { requireAuthUser } from "@/lib/dt/db";
import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const org = new URL(req.url).searchParams.get("org")?.trim() ?? "";
  const unreviewedOnly = new URL(req.url).searchParams.get("unreviewed") === "1";

  if (unreviewedOnly) {
    if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
      return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
    }
    const [edits, pendingCount] = await Promise.all([
      listUnreviewedCompanyProfileEdits(auth.supabase),
      countUnreviewedCompanyProfileEdits(auth.supabase),
    ]);
    return NextResponse.json({ ok: true, edits, pendingCount });
  }

  if (!org) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }
  if (!(await canManageDtAgents(auth.supabase, auth.userId, org))) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }
  const edits = await listCompanyProfileEditsForOrg(auth.supabase, org);
  return NextResponse.json({ ok: true, edits });
}

const reviewSchema = z.object({
  editId: z.string().uuid(),
});

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }
  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  }
  const result = await markCompanyProfileEditReviewed({
    supabase: auth.supabase,
    editId: parsed.data.editId,
    reviewerUserId: auth.userId,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
