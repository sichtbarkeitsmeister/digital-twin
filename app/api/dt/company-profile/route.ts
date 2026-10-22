import { NextResponse } from "next/server";
import { z } from "zod";

import {
  loadCompanyProfile,
  saveCompanyProfile,
} from "@/lib/dt/company-profile";
import { requireAuthUser } from "@/lib/dt/db";
import { canManageDtAgents, isPlatformAdmin } from "@/lib/dt/org-access";

const contactSchema = z.object({
  name: z.string().max(120),
  role: z.string().max(120),
  email: z.string().max(200),
  phone: z.string().max(80),
});

const patchSchema = z.object({
  organisationId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(160),
  websiteUrl: z.string().trim().max(500).optional().default(""),
  contacts: z.array(contactSchema).max(5),
  points: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        current: z.string().max(8_000),
      }),
    )
    .max(20),
  note: z.string().trim().max(2_000).optional(),
});

async function isOrgMember(
  supabase: Awaited<ReturnType<typeof requireAuthUser>>["supabase"],
  userId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(supabase, userId)) return true;
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return true;
  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  return Boolean(org);
}

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const organisationId = new URL(req.url).searchParams.get("org")?.trim() ?? "";
  if (!organisationId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }
  if (!(await isOrgMember(auth.supabase, auth.userId, organisationId))) {
    return NextResponse.json({ ok: false, message: "Kein Zugriff." }, { status: 403 });
  }
  const canEdit = await canManageDtAgents(auth.supabase, auth.userId, organisationId);
  const profile = await loadCompanyProfile(auth.supabase, organisationId, canEdit);
  if (!profile) {
    return NextResponse.json({ ok: false, message: "Organisation nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, profile });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  }
  const { organisationId } = parsed.data;
  if (!(await canManageDtAgents(auth.supabase, auth.userId, organisationId))) {
    return NextResponse.json(
      { ok: false, message: "Nur Inhaber und Admins dürfen das Firmenprofil bearbeiten." },
      { status: 403 },
    );
  }

  const result = await saveCompanyProfile({
    supabase: auth.supabase,
    organisationId,
    userId: auth.userId,
    displayName: parsed.data.displayName,
    websiteUrl: parsed.data.websiteUrl,
    contacts: parsed.data.contacts,
    points: parsed.data.points,
    note: parsed.data.note,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    profile: result.profile,
    editId: result.editId,
    changed: Boolean(result.editId),
  });
}
