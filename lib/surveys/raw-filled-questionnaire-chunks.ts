/** Shared text helpers for Word/mammoth questionnaire pastes (safe for client + server). */

const SECTION_HEADER_RE =
  /^(?:#{1,3}\s+|(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+\s*)+)(.+)$/u;

/** Normalize mammoth/Word paste so section headers and paragraphs are easier to chunk. */
export function normalizeWordQuestionnaireText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(
      /([^\n])(\n?)((?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}][\u{FE0F}\u{200D}]*)+\s+[A-ZÄÖÜa-zäöü])/gu,
      "$1\n\n$3",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a large questionnaire into section chunks (emoji / markdown headers).
 * Falls back to size-based slices when few headers exist.
 */
export function splitQuestionnaireIntoAiChunks(
  text: string,
): Array<{ title: string; body: string }> {
  const normalized = normalizeWordQuestionnaireText(text);
  const lines = normalized.split("\n");
  const chunks: Array<{ title: string; body: string }> = [];
  let currentTitle = "Allgemein";
  let buf: string[] = [];
  let preamble: string[] = [];
  let sawHeader = false;

  const flush = () => {
    const body = buf.join("\n").trim();
    if (!body) {
      buf = [];
      return;
    }
    chunks.push({ title: currentTitle, body });
    buf = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    const header = trimmed.match(SECTION_HEADER_RE);
    if (header && trimmed.length <= 100) {
      if (!sawHeader && (buf.length || preamble.length)) {
        preamble.push(...buf);
        buf = [];
      } else if (sawHeader) {
        flush();
      }
      sawHeader = true;
      currentTitle = (header[1] ?? trimmed).replace(/^#+\s*/, "").trim() || trimmed;
      continue;
    }
    if (!sawHeader) preamble.push(raw);
    else buf.push(raw);
  }
  flush();

  if (chunks.length >= 2) {
    if (preamble.join("\n").trim().length > 80) {
      return [
        { title: "Einleitung", body: preamble.join("\n").trim() },
        ...chunks,
      ];
    }
    return chunks;
  }

  const maxChars = 6_000;
  if (normalized.length <= maxChars) {
    return [{ title: "Fragebogen", body: normalized }];
  }
  const parts: Array<{ title: string; body: string }> = [];
  let start = 0;
  let idx = 1;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
      if (lastBreak > maxChars * 0.4) end = start + lastBreak;
    }
    const body = normalized.slice(start, end).trim();
    if (body) parts.push({ title: `Teil ${idx}`, body });
    start = end;
    idx += 1;
  }
  return parts;
}
