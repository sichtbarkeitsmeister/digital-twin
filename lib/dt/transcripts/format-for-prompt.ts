import type { SupabaseClient } from "@supabase/supabase-js";

import { personasFromJson } from "@/lib/dt/transcripts/parse-extract";
import type {
  DtMeetingTranscriptRow,
  DtTranscriptDetail,
  DtTranscriptListItem,
  DtTranscriptPersonaExtract,
  DtTranscriptStatus,
} from "@/lib/dt/transcripts/types";

export function serializeTranscriptListItem(
  row: DtMeetingTranscriptRow,
): DtTranscriptListItem {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    filename: row.filename,
    mimeType: row.mime_type,
    title: row.title,
    notes: row.notes,
    summary: row.summary,
    anbieterMarkdown: row.anbieter_markdown,
    personas: personasFromJson(row.personas_json),
    status: row.status,
    errorMessage: row.error_message,
    appliedAt: row.applied_at,
    uploadedBy: row.uploaded_by,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rawTextChars: row.raw_text?.length ?? 0,
  };
}

export function serializeTranscriptDetail(row: DtMeetingTranscriptRow): DtTranscriptDetail {
  return {
    ...serializeTranscriptListItem(row),
    rawText: row.raw_text,
  };
}

const LIST_SELECT =
  "id,organisation_id,filename,mime_type,title,notes,raw_text,summary,anbieter_markdown,personas_json,status,error_message,applied_at,uploaded_by,processed_at,created_at,updated_at";

export async function listMeetingTranscripts(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<DtMeetingTranscriptRow[]> {
  const { data, error } = await supabase
    .from("dt_meeting_transcripts")
    .select(LIST_SELECT)
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DtMeetingTranscriptRow[];
}

export function isTranscriptStatus(value: string): value is DtTranscriptStatus {
  return value === "uploaded" || value === "processing" || value === "processed" || value === "error";
}

export function formatTranscriptKnowledgeForPrompt(input: {
  transcripts: Array<{
    title: string | null;
    filename: string | null;
    summary: string | null;
    anbieterMarkdown: string | null;
    personas: DtTranscriptPersonaExtract[];
    processedAt: string | null;
  }>;
  emptyHint?: boolean;
}): string {
  const rows = input.transcripts.filter(
    (t) =>
      Boolean(t.summary?.trim()) ||
      Boolean(t.anbieterMarkdown?.trim()) ||
      t.personas.length > 0,
  );
  if (rows.length === 0) {
    if (!input.emptyHint) return "";
    return [
      "## Meeting-Transkripte",
      "Noch keine ausgewerteten Transkripte. Nach dem Kundeninterview unter Verwaltung → Transkripte hochladen.",
    ].join("\n");
  }

  const blocks = [
    "## Meeting-Transkripte (Kundeninterviews)",
    "Das sind ausgewertete Gesprächsprotokolle — verbindlicher als die Website, wenn sie Fakten nennen. Fragebogen-Wissen nicht überschreiben, wenn das Transkript dazu schweigt.",
  ];

  rows.forEach((row, index) => {
    const label = row.title?.trim() || row.filename?.trim() || `Interview ${index + 1}`;
    const when = row.processedAt
      ? new Date(row.processedAt).toLocaleDateString("de-DE")
      : null;
    blocks.push("", `### ${label}${when ? ` (${when})` : ""}`);
    if (row.summary?.trim()) blocks.push(row.summary.trim());
    if (row.anbieterMarkdown?.trim()) {
      blocks.push("", "#### Anbieterwissen aus diesem Gespräch", row.anbieterMarkdown.trim());
    }
    if (row.personas.length > 0) {
      blocks.push("", "#### Wunschkunden / Mandate aus diesem Gespräch");
      for (const p of row.personas) {
        blocks.push(
          `- **${p.name}** (${p.priority}-Kunde${p.isPrimary ? ", primär" : ""}${p.role ? `, ${p.role}` : ""}): ${p.description}`,
        );
      }
    }
  });

  return blocks.join("\n");
}
