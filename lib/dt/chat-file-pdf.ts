import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { parseMarkdown, spansToText, type MdSpan } from "@/lib/shared/markdown-lite";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56;
const BODY = 11;
const LEADING = 1.42;
const INK = rgb(0.106, 0.106, 0.196); // #1b1b32
const MUTED = rgb(0.4, 0.4, 0.48);
const LINK = rgb(0.1, 0.3, 0.75);
const RULE = rgb(0.8, 0.84, 0.82);
const SHADE = rgb(0.953, 0.984, 0.969); // #f3fbf7

/** WinAnsi-safe text for Helvetica (covers German umlauts, not emoji). */
export function toWinAnsiPdfText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/–|—|−/g, "-")
    .replace(/‘|’|′|‚/g, "'")
    .replace(/“|”|″|„/g, '"')
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\t\n\r\x20-\x7e\xa0-\xff\u2022\u20ac]/g, "?");
}

/**
 * Text that holds HTML (a created page, a table) → Markdown the reader understands: headings, bold,
 * lists and paragraphs survive, every other tag is dropped.
 */
export function htmlishToMarkdown(text: string): string {
  if (!/<[a-z][\s\S]*?>/i.test(text)) return text;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|tr|table|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont; mono: PDFFont };

type Word = { text: string; font: PDFFont; color: ReturnType<typeof rgb>; underline: boolean };

function wordsOf(spans: readonly MdSpan[], fonts: Fonts, baseBold: boolean, baseColor = INK): Word[] {
  const words: Word[] = [];
  for (const span of spans) {
    const bold = span.bold || baseBold;
    const font = span.code ? fonts.mono : bold && span.italic ? fonts.boldItalic : bold ? fonts.bold : span.italic ? fonts.italic : fonts.regular;
    const color = span.href ? LINK : baseColor;
    for (const part of toWinAnsiPdfText(span.text).split(/(\s+)/)) {
      if (part) words.push({ text: part, font, color, underline: Boolean(span.href) });
    }
  }
  return words;
}

/** Cuts a word that is wider than the line into pieces that fit. */
function breakLongWord(word: Word, size: number, width: number): Word[] {
  if (word.font.widthOfTextAtSize(word.text, size) <= width) return [word];
  const pieces: Word[] = [];
  let current = "";
  for (const ch of word.text) {
    if (word.font.widthOfTextAtSize(current + ch, size) > width && current) {
      pieces.push({ ...word, text: current });
      current = ch;
    } else current += ch;
  }
  if (current) pieces.push({ ...word, text: current });
  return pieces;
}

/** Lines of words that fit `width`; spaces are kept inside a line, dropped at its ends. */
function wrap(words: Word[], size: number, width: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const raw of words) {
    for (const word of /\s/.test(raw.text) ? [raw] : breakLongWord(raw, size, width)) {
      const w = word.font.widthOfTextAtSize(word.text, size);
      if (/^\s+$/.test(word.text)) {
        if (line.length > 0) {
          line.push(word);
          used += w;
        }
        continue;
      }
      if (used + w > width && line.length > 0) {
        while (line.length > 0 && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(word);
      used += w;
    }
  }
  while (line.length > 0 && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [[]];
}

/**
 * A formatted multi-page A4 document from the twin's text: Markdown (or HTML) becomes headings, bold and
 * italic, bullet and numbered lists, tables, quotes and code. No „##“ or „**“ in the file. Visual HTML
 * layouts belong in HTML artifacts; this is the document to hand over or print.
 */
export async function createPdfFromText(input: { text: string; title?: string | null }): Promise<Uint8Array> {
  const title = input.title?.trim() || null;
  const blocks = parseMarkdown(htmlishToMarkdown(input.text) || " ");
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const contentWidth = A4_WIDTH - MARGIN * 2;
  let page: PDFPage = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  const ensure = (height: number) => {
    if (y - height < MARGIN) {
      page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
  };

  /** Draws wrapped words from `x` within `width`; returns nothing, moves `y`. */
  const drawWords = (words: Word[], size: number, x: number, width: number) => {
    for (const line of wrap(words, size, width)) {
      ensure(size * LEADING);
      let cx = x;
      for (const word of line) {
        page.drawText(word.text, { x: cx, y: y - size, size, font: word.font, color: word.color });
        const w = word.font.widthOfTextAtSize(word.text, size);
        if (word.underline && word.text.trim()) page.drawLine({ start: { x: cx, y: y - size - 1.5 }, end: { x: cx + w, y: y - size - 1.5 }, thickness: 0.5, color: word.color });
        cx += w;
      }
      y -= size * LEADING;
    }
  };

  // The file's title leads the document unless the text opens with its own H1.
  if (title && !(blocks[0]?.type === "heading" && blocks[0].level === 1)) {
    drawWords(wordsOf([{ text: title }], fonts, true), 20, MARGIN, contentWidth);
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 1, color: RULE });
    y -= 14;
  }

  const sizes = { 1: 18, 2: 14.5, 3: 12.5, 4: 11.5 } as const;
  for (const [i, block] of blocks.entries()) {
    switch (block.type) {
      case "heading": {
        const size = sizes[block.level];
        if (i > 0) y -= block.level <= 2 ? 10 : 6;
        ensure(size * LEADING * 2); // a heading is never alone at the foot of a page
        drawWords(wordsOf(block.spans, fonts, true), size, MARGIN, contentWidth);
        y -= 4;
        break;
      }
      case "paragraph":
        drawWords(wordsOf(block.spans, fonts, false), BODY, MARGIN, contentWidth);
        y -= 7;
        break;
      case "list": {
        for (const item of block.items) {
          const indent = 16 + item.depth * 16;
          const marker = block.ordered ? `${item.number}.` : "•";
          ensure(BODY * LEADING);
          page.drawText(marker, { x: MARGIN + indent - 14, y: y - BODY, size: BODY, font: fonts.regular, color: INK });
          drawWords(wordsOf(item.spans, fonts, false), BODY, MARGIN + indent, contentWidth - indent);
          y -= 2;
        }
        y -= 6;
        break;
      }
      case "quote": {
        const top = y;
        drawWords(wordsOf(block.spans.map((s) => ({ ...s, italic: true })), fonts, false, MUTED), BODY, MARGIN + 14, contentWidth - 14);
        page.drawLine({ start: { x: MARGIN + 4, y: top }, end: { x: MARGIN + 4, y: y + 2 }, thickness: 2, color: RULE });
        y -= 7;
        break;
      }
      case "rule":
        ensure(14);
        y -= 6;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_WIDTH - MARGIN, y }, thickness: 0.8, color: RULE });
        y -= 10;
        break;
      case "code": {
        const size = 9.5;
        const words = block.text.split("\n").map((line) => wordsOf([{ text: line || " ", code: true }], fonts, false));
        for (const line of words.flatMap((w) => wrap(w, size, contentWidth - 12))) {
          ensure(size * LEADING);
          page.drawRectangle({ x: MARGIN, y: y - size * LEADING + 2, width: contentWidth, height: size * LEADING, color: rgb(0.965, 0.969, 0.984) });
          let cx = MARGIN + 6;
          for (const word of line) {
            page.drawText(word.text, { x: cx, y: y - size, size, font: word.font, color: INK });
            cx += word.font.widthOfTextAtSize(word.text, size);
          }
          y -= size * LEADING;
        }
        y -= 7;
        break;
      }
      case "table": {
        const cols = block.header.length;
        const pad = 5;
        const weights = Array.from({ length: cols }, (_, c) => Math.min(40, Math.max(8, ...[block.header[c]!, ...block.rows.map((r) => r[c] ?? [])].map((cell) => spansToText(cell).length))));
        const total = weights.reduce((a, b) => a + b, 0);
        const widths = weights.map((w) => (w / total) * contentWidth);
        const drawRow = (cells: MdSpan[][], header: boolean) => {
          const wrapped = cells.map((cell, c) => wrap(wordsOf(cell, fonts, header), 10, (widths[c] ?? widths[0]!) - pad * 2));
          const height = Math.max(...wrapped.map((l) => l.length)) * 10 * LEADING + pad * 2;
          ensure(height);
          let x = MARGIN;
          wrapped.forEach((lines, c) => {
            const w = widths[c] ?? widths[0]!;
            page.drawRectangle({ x, y: y - height, width: w, height, borderColor: RULE, borderWidth: 0.6, color: header ? SHADE : undefined });
            let ly = y - pad;
            for (const line of lines) {
              let cx = x + pad;
              for (const word of line) {
                page.drawText(word.text, { x: cx, y: ly - 10, size: 10, font: word.font, color: word.color });
                cx += word.font.widthOfTextAtSize(word.text, 10);
              }
              ly -= 10 * LEADING;
            }
            x += w;
          });
          y -= height;
        };
        drawRow(block.header, true);
        for (const row of block.rows) drawRow(Array.from({ length: cols }, (_, c) => row[c] ?? []), false);
        y -= 9;
        break;
      }
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Seite ${i + 1} von ${pages.length}`;
    const w = fonts.regular.widthOfTextAtSize(label, 8.5);
    p.drawText(label, { x: A4_WIDTH - MARGIN - w, y: MARGIN - 24, size: 8.5, font: fonts.regular, color: MUTED });
  });
  return doc.save();
}
