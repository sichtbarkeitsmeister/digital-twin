/**
 * Uploaded conversation notes / meeting summaries used to prefill Fragebogen answers.
 * Testable without DB: npx tsx scripts/test-source-documents.ts
 */

export type SourceDocument = {
  name: string;
  text: string;
};

const PER_DOC_MAX = 20_000;
const TOTAL_MAX = 48_000;

export function normalizeSourceDocuments(
  docs: Array<{ name?: unknown; text?: unknown }> | null | undefined,
): SourceDocument[] {
  const out: SourceDocument[] = [];
  let used = 0;
  for (const doc of docs ?? []) {
    const name = String(doc.name ?? "").trim().slice(0, 200) || "Datei";
    const text = String(doc.text ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length < 20) continue;
    const remaining = TOTAL_MAX - used;
    if (remaining < 20) break;
    const clipped = text.slice(0, Math.min(PER_DOC_MAX, remaining));
    out.push({ name, text: clipped });
    used += clipped.length;
    if (out.length >= 8) break;
  }
  return out;
}

export function formatSourceDocuments(docs: SourceDocument[]): string {
  if (docs.length === 0) return "";
  return docs
    .map(
      (doc, index) =>
        `### Datei ${index + 1}: ${doc.name}\n${doc.text}`,
    )
    .join("\n\n");
}
