/** Shared text helpers for Word/mammoth questionnaire pastes (safe for client + server). */

const SECTION_HEADER_RE =
  /^(?:#{1,3}\s+|(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+\s*)+)(.+)$/u;

const NUMBERED_SECTION_RE =
  /^(?:\d{1,2}[\.)]\s+|[A-ZÄÖÜ][\.)]\s+)(.{4,80})$/;

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

function splitBySize(
  text: string,
  maxChars: number,
  titlePrefix: string,
): Array<{ title: string; body: string }> {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) {
    return [{ title: titlePrefix, body: normalized }];
  }
  const parts: Array<{ title: string; body: string }> = [];
  let start = 0;
  let idx = 1;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const qBreak = slice.lastIndexOf("?\n");
      const pBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
      const lastBreak = qBreak > maxChars * 0.35 ? qBreak + 1 : pBreak;
      if (lastBreak > maxChars * 0.35) end = start + lastBreak;
    }
    const body = normalized.slice(start, end).trim();
    if (body) {
      parts.push({
        title: parts.length === 0 ? titlePrefix : `${titlePrefix} (${idx})`,
        body,
      });
    }
    start = end;
    idx += 1;
  }
  return parts;
}

/**
 * Split a large questionnaire into small AI-friendly chunks.
 * Prefer emoji/markdown/numbered headers, then hard-split oversized pieces.
 */
export function splitQuestionnaireIntoAiChunks(
  text: string,
): Array<{ title: string; body: string }> {
  const normalized = normalizeWordQuestionnaireText(text);
  const maxChars = 3_500;
  const lines = normalized.split("\n");
  const rough: Array<{ title: string; body: string }> = [];
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
    rough.push({ title: currentTitle, body });
    buf = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    const emojiHeader = trimmed.match(SECTION_HEADER_RE);
    const numbered =
      !emojiHeader && trimmed.length <= 90 ? trimmed.match(NUMBERED_SECTION_RE) : null;
    const header = emojiHeader || numbered;
    if (header) {
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

  let sections: Array<{ title: string; body: string }> = [];
  if (rough.length >= 2) {
    if (preamble.join("\n").trim().length > 80) {
      sections = [
        { title: "Einleitung", body: preamble.join("\n").trim() },
        ...rough,
      ];
    } else {
      sections = rough;
    }
  } else {
    sections = [{ title: "Fragebogen", body: normalized }];
  }

  // Always re-split oversized sections so no single Anthropic call is huge.
  const out: Array<{ title: string; body: string }> = [];
  for (const section of sections) {
    out.push(...splitBySize(section.body, maxChars, section.title));
  }
  return out.length > 0 ? out : [{ title: "Fragebogen", body: normalized }];
}
