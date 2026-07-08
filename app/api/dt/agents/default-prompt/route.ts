import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { isPlatformAdmin } from "@/lib/dt/org-access";

const patchSchema = z.object({
  slug: z.enum(["default", "seo_advisor"]),
  prompt: z.string().trim().min(1).max(32_000),
});

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json({ ok: false, message: "Keine Berechtigung." }, { status: 403 });
  }

  const { data, error } = await auth.supabase
    .from("dt_agent_templates")
    .select("slug,name,default_prompt")
    .in("slug", ["default", "seo_advisor"]);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const prompts: Record<string, string> = {};
  for (const row of data ?? []) {
    prompts[row.slug] = row.default_prompt ?? "";
  }

  return NextResponse.json({ ok: true, prompts });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  if (!(await isPlatformAdmin(auth.supabase, auth.userId))) {
    return NextResponse.json(
      { ok: false, message: "Globale Prompts können nur von Administratoren bearbeitet werden." },
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

  const { error } = await auth.supabase.rpc("dt_update_default_prompt", {
    p_slug: parsed.data.slug,
    p_prompt: parsed.data.prompt,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message || "Speichern fehlgeschlagen." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
