const MARKDOWN_FILENAME = /\.(md|markdown)$/i;

/** Uploaded workshop summaries arrive as Markdown. The file name is the signal. */
export function isMarkdownTranscriptFilename(filename: string | null | undefined): boolean {
  return MARKDOWN_FILENAME.test((filename ?? "").trim());
}

/**
 * A summary row is the summary itself: a pasted or uploaded summary (source_kind
 * "summary") and every Markdown file. Such rows keep the text in raw_text and often
 * leave the summary column empty (Markdown rows saved before that rule even have
 * source_kind "raw"); the body then counts as the summary.
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
  if (sourceKind === "summary" && input.rawText?.trim()) {
    return { sourceKind, summary: input.rawText };
  }
  return { sourceKind, summary: input.summary ?? null };
}

/** File name for a Markdown download: lower case, umlauts spelled out, „.md“ at the end. */
export function markdownDownloadName(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "zusammenfassung"}.md`;
}

/** The saved summary of one conversation as a Markdown file: title, date, summary. */
export function transcriptSummaryMarkdown(input: {
  title: string | null;
  filename: string | null;
  spokenOn: string | null;
  summary: string;
}): string {
  const title = input.title?.trim() || input.filename?.trim() || "Gespräch";
  const [year, month, day] = (input.spokenOn ?? "").split("-");
  const date = year && month && day ? `Gespräch vom ${day}.${month}.${year}` : "";
  return [`# ${title}`, date, input.summary.trim()].filter(Boolean).join("\n\n").concat("\n");
}
