/**
 * Convert mammoth HTML from a filled Word questionnaire into import-friendly text.
 * Tables (typical form layout) become „Frage“ + „Antwort:“ pairs.
 * Safe for browser and Node (no DOM required).
 */

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function convertTable(tableHtml: string): string {
  const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const out: string[] = [];

  for (const row of rows) {
    const cells = (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) =>
      stripTags(cell),
    );
    const nonempty = cells.filter(Boolean);
    if (nonempty.length === 0) continue;

    if (nonempty.length === 1) {
      // Section label / single cell
      out.push(nonempty[0]!);
      out.push("");
      continue;
    }

    const question = nonempty[0]!;
    const answer = nonempty.slice(1).join(" | ").trim();
    // Skip pure header rows (Frage/Antwort)
    if (/^frage$/i.test(question) && /^antwort/i.test(answer)) continue;

    out.push(question);
    if (answer) out.push(`Antwort: ${answer}`);
    out.push("");
  }

  return out.join("\n");
}

/**
 * Turn Word/mammoth HTML into plain text optimized for raw-filled parsers + KI.
 */
export function questionnaireHtmlToImportText(html: string): string {
  if (!html.trim()) return "";

  let working = html
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Tables first (form layouts) — replace in place with structured text.
  working = working.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const converted = convertTable(table);
    return `\n\n${converted}\n\n`;
  });

  // Headings → section breaks
  working = working.replace(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _lvl, inner) => {
    const title = stripTags(String(inner));
    return title ? `\n\n${title}\n\n` : "\n\n";
  });

  // Lists
  working = working.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
    const item = stripTags(String(inner));
    return item ? `${item}\n` : "";
  });

  // Paragraphs / divs
  working = working.replace(/<\/?(div|p|section|article|header|footer)\b[^>]*>/gi, "\n");
  working = working.replace(/<br\s*\/?>/gi, "\n");

  // Drop remaining tags
  working = stripTags(working);

  return working
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Prefer HTML extraction; fall back to raw text if HTML yields almost nothing. */
export function pickBestDocxExtraction(input: {
  htmlText: string;
  rawText: string;
}): string {
  const html = input.htmlText.trim();
  const raw = input.rawText.trim();
  if (!html) return raw;
  if (!raw) return html;

  const htmlAntwort = (html.match(/^Antwort\s*:/gim) ?? []).length;
  const rawAntwort = (raw.match(/^Antwort\s*:/gim) ?? []).length;
  const htmlQ = (html.match(/\?/g) ?? []).length;
  const rawQ = (raw.match(/\?/g) ?? []).length;
  const htmlLines = html.split(/\n/).filter((l) => l.trim()).length;
  const rawLines = raw.split(/\n/).filter((l) => l.trim()).length;

  // Prefer HTML when it recovered table answers or clearly more structure.
  if (htmlAntwort > rawAntwort) return html;
  if (htmlAntwort === rawAntwort && htmlLines >= rawLines * 0.9 && html.length >= raw.length * 0.7) {
    // Prefer more question marks / lines as a weak signal of structure.
    if (htmlQ > rawQ || htmlLines > rawLines) return html;
  }
  if (htmlLines > rawLines * 1.2) return html;
  return raw.length >= html.length ? raw : html;
}
