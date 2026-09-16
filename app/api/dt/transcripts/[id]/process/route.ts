import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import { applyTranscriptExtractToOrg } from "@/lib/dt/transcripts/apply-knowledge";
import { extractKnowledgeFromTranscript } from "@/lib/dt/transcripts/extract";
import { serializeTranscriptListItem } from "@/lib/dt/transcripts/format-for-prompt";
import type { DtMeetingTranscriptRow } from "@/lib/dt/transcripts/types";

export const maxDuration = 300;

const SELECT =
  "id,organisation_id,filename,mime_type,title,notes,raw_text,summary,anbieter_markdown,personas_json,status,error_message,applied_at,uploaded_by,processed_at,created_at,updated_at";

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
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, message: "Transkript nicht gefunden." }, { status: 404 });
  }

  const row = data as DtMeetingTranscriptRow;
  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, row.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  await auth.supabase
    .from("dt_meeting_transcripts")
    .update({ status: "processing", error_message: null })
    .eq("id", id);

  const { data: org } = await auth.supabase
    .from("organisations")
    .select("name")
    .eq("id", row.organisation_id)
    .maybeSingle();
  const { data: orgConfig } = await auth.supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", row.organisation_id)
    .maybeSingle();
  const organisationName =
    orgConfig?.display_name?.trim() || org?.name?.trim() || "Organisation";

  try {
    const { extract, usage, model } = await extractKnowledgeFromTranscript({
      organisationName,
      filename: row.filename,
      text: row.raw_text,
    });

    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      await recordLlmUsageEvent(auth.supabase, {
        organisationId: row.organisation_id,
        userId: auth.userId,
        via: "direct",
        mode: "transcript",
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    }

    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await auth.supabase
      .from("dt_meeting_transcripts")
      .update({
        title: extract.title || row.title,
        summary: extract.summary,
        anbieter_markdown: extract.anbieterMarkdown || null,
        personas_json: extract.personas,
        status: "processed",
        processed_at: now,
        error_message: null,
      })
      .eq("id", id)
      .select(SELECT)
      .single();

    if (saveError || !saved) {
      throw new Error(saveError?.message ?? "Auswertung konnte nicht gespeichert werden.");
    }

    const applied = await applyTranscriptExtractToOrg({
      supabase: auth.supabase,
      organisationId: row.organisation_id,
      extract,
    });

    const applyNote =
      applied.warnings.length > 0 ? applied.warnings.join(" · ").slice(0, 1800) : null;
    const { data: finalRow, error: applySaveError } = await auth.supabase
      .from("dt_meeting_transcripts")
      .update({
        applied_at: new Date().toISOString(),
        error_message: applyNote,
      })
      .eq("id", id)
      .select(SELECT)
      .single();

    if (applySaveError) {
      console.warn("[dt/transcripts] apply save:", applySaveError.message);
    }

    return NextResponse.json({
      ok: true,
      transcript: serializeTranscriptListItem(
        (finalRow ?? saved) as DtMeetingTranscriptRow,
      ),
      createdPersonaIds: applied.createdPersonaIds,
      updatedPersonaIds: applied.updatedPersonaIds,
      warnings: applied.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auswertung fehlgeschlagen.";
    await auth.supabase
      .from("dt_meeting_transcripts")
      .update({ status: "error", error_message: message.slice(0, 1800) })
      .eq("id", id);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
