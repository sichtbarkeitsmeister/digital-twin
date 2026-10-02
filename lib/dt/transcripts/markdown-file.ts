const MARKDOWN_FILENAME = /\.(md|markdown)$/i;

/** Uploaded workshop summaries arrive as Markdown. The file name is the signal. */
export function isMarkdownTranscriptFilename(filename: string | null | undefined): boolean {
  return MARKDOWN_FILENAME.test((filename ?? "").trim());
}

/**
 * A Markdown file is the summary itself. Rows saved before that rule still have
 * source_kind "raw" and an empty summary column; the body lives in raw_text.
 */
export function resolveTranscriptReading(input: {
  filename?: string | null;
  sourceKind?: string | null;
  summary?: string | null;
  rawText?: string | null;
}): { sourceKind: "raw" | "summary"; summary: string | null } {
  const markdown = isMarkdownTranscriptFilename(input.filename);
  const sourceKind: "raw" | "summary" =
    input.sourceKind === "summary" || markdown ? "summary" : "raw";
  const stored = input.summary?.trim() ? input.summary : null;
  if (stored) return { sourceKind, summary: stored };
  if (markdown && input.rawText?.trim()) {
    return { sourceKind, summary: input.rawText };
  }
  return { sourceKind, summary: input.summary ?? null };
}
