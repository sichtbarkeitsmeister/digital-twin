import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";

const patchSchema = z.object({
  checklist: z.array(z.union([z.string(), z.object({ label: z.string() })])),
});

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .select("global_seo_checklist")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    checklist: data?.global_seo_checklist ?? [],
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Globale Checkliste kann nur von Administratoren bearbeitet werden." },
      { status: 403 },
    );
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const checklist = parsed.data.checklist
    .map((item) => (typeof item === "string" ? item.trim() : item.label.trim()))
    .filter(Boolean);

  const { data, error } = await auth.supabase
    .from("dt_platform_settings")
    .upsert(
      { id: "default", global_seo_checklist: checklist },
      { onConflict: "id" },
    )
    .select("global_seo_checklist")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, checklist: data.global_seo_checklist });
}
