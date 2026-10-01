import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import { TRANSCRIPT_ROW_SELECT, serializeTranscriptListItem } from "@/lib/dt/transcripts/format-for-prompt";
import type { DtMeetingTranscriptRow } from "@/lib/dt/transcripts/types";
import { summarizeTranscript } from "@/lib/dt/transcripts/workshop-llm";

export const maxDuration = 300;

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
    .select(TRANSCRIPT_ROW_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, message: "Transkript nicht gefunden." }, { status: 404 });

  const row = data as DtMeetingTranscriptRow;
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, row.organisation_id);
  if (!gate.ok) return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  if (row.source_kind === "summary") {
    return NextResponse.json(
      { ok: false, message: "Das ist schon eine Zusammenfassung." },
      { status: 400 },
    );
  }

  const { data: org } = await auth.supabase
    .from("organisations")
    .select("name")
    .eq("id", row.organisation_id)
    .maybeSingle();

  try {
    const result = await summarizeTranscript({
      organisationName: org?.name?.trim() || "Organisation",
      title: row.title || row.filename || "Gespräch",
      text: row.raw_text,
    });
    await recordLlmUsageEvent(auth.supabase, {
      organisationId: row.organisation_id,
      userId: auth.userId,
      via: "direct",
      mode: "transcript",
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    const { data: saved, error: saveError } = await auth.supabase
      .from("dt_meeting_transcripts")
      .update({ summary: result.summary })
      .eq("id", id)
      .select(TRANSCRIPT_ROW_SELECT)
      .single();
    if (saveError || !saved) {
      return NextResponse.json(
        { ok: false, message: saveError?.message ?? "Zusammenfassung konnte nicht gespeichert werden." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      transcript: serializeTranscriptListItem(saved as DtMeetingTranscriptRow),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Zusammenfassung fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
