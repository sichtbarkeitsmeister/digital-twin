import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import {
  createConfirmedTranscriptPersonas,
  personasAwaitingConfirmation,
} from "@/lib/dt/transcripts/apply-knowledge";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import { personasFromJson } from "@/lib/dt/transcripts/parse-extract";
import type { DtMeetingTranscriptRow } from "@/lib/dt/transcripts/types";

const bodySchema = z.object({
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
});

const SELECT =
  "id,organisation_id,personas_json,status";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Bitte mindestens eine Persona auswählen." },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from("dt_meeting_transcripts")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Transkript nicht gefunden." }, { status: 404 });
  }

  const row = data as Pick<DtMeetingTranscriptRow, "id" | "organisation_id" | "personas_json" | "status">;
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, row.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }
  if (row.status !== "processed") {
    return NextResponse.json(
      { ok: false, message: "Das Transkript ist noch nicht ausgewertet." },
      { status: 400 },
    );
  }

  const personas = personasFromJson(row.personas_json);
  const created = await createConfirmedTranscriptPersonas({
    supabase: auth.supabase,
    organisationId: row.organisation_id,
    personas,
    names: parsed.data.names,
  });

  const { data: agents } = await auth.supabase
    .from("dt_agents")
    .select("name,slug,kind")
    .eq("organisation_id", row.organisation_id);
  const pendingPersonas = personasAwaitingConfirmation(
    personas,
    (agents ?? []).map((agent) => ({
      name: typeof agent.name === "string" ? agent.name : "",
      slug: typeof agent.slug === "string" ? agent.slug : null,
      kind: typeof agent.kind === "string" ? agent.kind : "",
    })),
  );

  return NextResponse.json({
    ok: true,
    createdNames: created.createdNames,
    createdPersonaIds: created.createdPersonaIds,
    pendingPersonas,
    warnings: created.warnings,
  });
}
