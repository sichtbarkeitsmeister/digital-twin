import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatTranscriptKnowledgeForPrompt,
  listMeetingTranscripts,
} from "@/lib/dt/transcripts/format-for-prompt";
import { personasFromJson } from "@/lib/dt/transcripts/parse-extract";

export async function loadTranscriptKnowledgeForPrompt(
  supabase: SupabaseClient,
  organisationId: string,
  options?: { emptyHint?: boolean },
): Promise<string> {
  const rows = await listMeetingTranscripts(supabase, organisationId);
  return formatTranscriptKnowledgeForPrompt({
    transcripts: rows
      .filter((r) => r.status === "processed")
      .map((r) => ({
        title: r.title,
        filename: r.filename,
        summary: r.summary,
        anbieterMarkdown: r.anbieter_markdown,
        personas: personasFromJson(r.personas_json),
        processedAt: r.processed_at,
      })),
    emptyHint: options?.emptyHint,
  });
}
