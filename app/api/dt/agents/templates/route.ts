import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { data, error } = await auth.supabase
    .from("dt_agent_templates")
    .select(
      "id,slug,kind,name,short_description,long_description,is_public,created_at",
    )
    .is("archived_at", null)
    .eq("is_public", true)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: data ?? [] });
}
