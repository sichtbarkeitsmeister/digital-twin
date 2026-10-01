import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from("dt_meeting_transcripts")
    .select("id,organisation_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Transkript nicht gefunden." }, { status: 404 });
  }

  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, data.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  return NextResponse.json(
    {
      ok: false,
      message:
        "Einzelne Transkripte werden nicht mehr ausgewertet. Bitte den Bestand im Workshop auswerten und freigeben.",
    },
    { status: 409 },
  );
}
