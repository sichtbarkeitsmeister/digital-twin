import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import { applyTranscriptExtractToOrg } from "@/lib/dt/transcripts/apply-knowledge";
import {
  serializeTranscriptDetail,
  serializeTranscriptListItem,
} from "@/lib/dt/transcripts/format-for-prompt";
import type { DtMeetingTranscriptRow } from "@/lib/dt/transcripts/types";
import { sanitizeTranscriptText } from "@/lib/dt/transcripts/sanitize";

const patchSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
});

const SELECT =
  "id,organisation_id,filename,mime_type,title,notes,raw_text,summary,anbieter_markdown,personas_json,status,error_message,applied_at,uploaded_by,processed_at,created_at,updated_at";

async function loadOwnedTranscript(
  supabase: Awaited<ReturnType<typeof requireAuthUser>>["supabase"],
  userId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("dt_meeting_transcripts")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { ok: false as const, status: 500, message: error.message };
  }
  if (!data) {
    return { ok: false as const, status: 404, message: "Transkript nicht gefunden." };
  }
  const row = data as DtMeetingTranscriptRow;
  const gate = await requireTranscriptAccess(supabase, userId, row.organisation_id);
  if (!gate.ok) return { ok: false as const, status: gate.status, message: gate.message };
  return { ok: true as const, row };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const loaded = await loadOwnedTranscript(auth.supabase, auth.userId, id);
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, message: loaded.message }, { status: loaded.status });
  }
  return NextResponse.json({ ok: true, transcript: serializeTranscriptDetail(loaded.row) });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const loaded = await loadOwnedTranscript(auth.supabase, auth.userId, id);
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, message: loaded.message }, { status: loaded.status });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) {
    patch.title = parsed.data.title
      ? sanitizeTranscriptText(parsed.data.title).trim() || null
      : null;
  }
  if (parsed.data.notes !== undefined) {
    patch.notes = parsed.data.notes
      ? sanitizeTranscriptText(parsed.data.notes).trim() || null
      : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, transcript: serializeTranscriptListItem(loaded.row) });
  }

  const { data, error } = await auth.supabase
    .from("dt_meeting_transcripts")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Aktualisieren fehlgeschlagen." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, transcript: serializeTranscriptListItem(data) });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const loaded = await loadOwnedTranscript(auth.supabase, auth.userId, id);
  if (!loaded.ok) {
    return NextResponse.json({ ok: false, message: loaded.message }, { status: loaded.status });
  }

  const { error } = await auth.supabase.from("dt_meeting_transcripts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  try {
    await applyTranscriptExtractToOrg({
      supabase: auth.supabase,
      organisationId: loaded.row.organisation_id,
      extract: { title: null, summary: "", anbieterMarkdown: "", personas: [] },
    });
  } catch (err) {
    console.warn(
      "[dt/transcripts] anbieter resync after delete:",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}
