import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { personasAwaitingConfirmation } from "@/lib/dt/transcripts/apply-knowledge";
import { requireTranscriptAccess } from "@/lib/dt/transcripts/access";
import {
  TRANSCRIPT_ROW_SELECT,
  listMeetingTranscripts,
  serializeTranscriptListItem,
} from "@/lib/dt/transcripts/format-for-prompt";
import { isMarkdownTranscriptFilename } from "@/lib/dt/transcripts/markdown-file";
import { clipTranscriptRaw, sanitizeTranscriptText } from "@/lib/dt/transcripts/sanitize";

const postSchema = z.object({
  organisationId: z.string().uuid(),
  text: z.string().min(40).max(180_000),
  filename: z.string().trim().max(240).nullable().optional(),
  mimeType: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sourceKind: z.enum(["raw", "summary"]).optional(),
  spokenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const orgId = new URL(req.url).searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "Organisation fehlt." }, { status: 400 });
  }

  const gate = await requireTranscriptAccess(auth.supabase, auth.userId, orgId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  try {
    const rows = await listMeetingTranscripts(auth.supabase, orgId);
    const { data: agents } = await auth.supabase
      .from("dt_agents")
      .select("name,slug,kind")
      .eq("organisation_id", orgId);
    const matchAgents = (agents ?? []).map((agent) => ({
      name: typeof agent.name === "string" ? agent.name : "",
      slug: typeof agent.slug === "string" ? agent.slug : null,
      kind: typeof agent.kind === "string" ? agent.kind : "",
    }));
    return NextResponse.json({
      ok: true,
      transcripts: rows.map((row) => {
        const item = serializeTranscriptListItem(row);
        return {
          ...item,
          pendingPersonas: personasAwaitingConfirmation(item.personas, matchAgents),
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transkripte konnten nicht geladen werden.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const gate = await requireTranscriptAccess(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const rawText = clipTranscriptRaw(parsed.data.text);
  if (rawText.length < 40) {
    return NextResponse.json(
      { ok: false, message: "Transkript ist zu kurz." },
      { status: 400 },
    );
  }

  const filename = parsed.data.filename
    ? sanitizeTranscriptText(parsed.data.filename).trim() || null
    : null;
  const title = parsed.data.title
    ? sanitizeTranscriptText(parsed.data.title).trim() || null
    : filename;
  const notes = parsed.data.notes
    ? sanitizeTranscriptText(parsed.data.notes).trim() || null
    : null;
  const sourceKind =
    parsed.data.sourceKind === "summary" || isMarkdownTranscriptFilename(filename)
      ? "summary"
      : "raw";

  const { data, error } = await auth.supabase
    .from("dt_meeting_transcripts")
    .insert({
      organisation_id: parsed.data.organisationId,
      filename,
      mime_type: parsed.data.mimeType?.trim() || null,
      title,
      notes,
      source_kind: sourceKind,
      spoken_on: parsed.data.spokenOn ?? null,
      raw_text: rawText,
      summary: sourceKind === "summary" ? rawText : null,
      status: "uploaded",
      uploaded_by: auth.userId,
    })
    .select(TRANSCRIPT_ROW_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Transkript konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    transcript: serializeTranscriptListItem(data),
  });
}
