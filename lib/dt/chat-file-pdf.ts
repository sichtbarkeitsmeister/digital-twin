import { PDFDocument, StandardFonts } from "pdf-lib";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const TITLE_SIZE = 16;

/** WinAnsi-safe text for Helvetica (covers German umlauts, not emoji). */
export function toWinAnsiPdfText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u2013|\u2014|\u2212/g, "-")
    .replace(/\u2018|\u2019|\u2032|\u201a/g, "'")
    .replace(/\u201c|\u201d|\u2033|\u201e/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\u2022/g, "-")
    .replace(/[^\t\n\r\x20-\x7e\xa0-\xff]/g, "?");
}

function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + word).length > maxChars && current.trim()) {
      lines.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current += word;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [""];
}

function htmlishToPlain(text: string): string {
  if (!/<[a-z][\s\S]*?>/i.test(text)) return text;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Simple multi-page A4 text PDF. Visual HTML layouts belong in HTML artifacts;
 * this is the downloadable document the twin can hand over.
 */
export async function createPdfFromText(input: {
  text: string;
  title?: string | null;
}): Promise<Uint8Array> {
  const title = input.title?.trim() || null;
  const body = toWinAnsiPdfText(htmlishToPlain(input.text) || " ");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxChars = 92;
  const lines = body.split("\n").flatMap((line) => wrapLine(line, maxChars));
  const usableHeight = A4_HEIGHT - MARGIN * 2;
  let y = 0;
  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  y = A4_HEIGHT - MARGIN;

  const drawLine = (text: string, size: number, face: typeof font) => {
    if (y < MARGIN + LINE_HEIGHT) {
      page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
    page.drawText(text || " ", {
      x: MARGIN,
      y,
      size,
      font: face,
    });
    y -= size === TITLE_SIZE ? LINE_HEIGHT + 8 : LINE_HEIGHT;
    void usableHeight;
  };

  if (title) {
    const titleLines = wrapLine(toWinAnsiPdfText(title), 70);
    for (const line of titleLines) drawLine(line, TITLE_SIZE, bold);
    y -= 8;
  }

  for (const line of lines) {
    drawLine(line, FONT_SIZE, font);
  }

  return doc.save();
}
