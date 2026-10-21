/**
 * File ingestion for the text tools (Verwaltung → GEO): an uploaded .txt, .html, .pdf or
 * .docx becomes the `ContentTextBlock[]` the pipeline prompts read. Two stages:
 *
 *   1. `extractUploadedDocument` – bytes → text or HTML (server only: unpdf, mammoth).
 *   2. `blocksFromDocument`     – text/HTML → blocks, title, meta description (pure).
 *
 * The second stage is pure so the heuristics are testable (scripts/test-text-tools-geo.ts).
 */

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { DT_MAX_ATTACHMENT_BYTES } from "@/lib/dt/attachments-shared";
import { escapeHtml, normalizeBlocks, parseBlocksFromHtml, sanitizeBlockHtml, type ContentTextBlock } from "@/lib/dt/content/render";

/** Same limit as a chat attachment; the text itself is capped separately below. */
export const TEXT_TOOL_MAX_FILE_BYTES = DT_MAX_ATTACHMENT_BYTES;
/** Longer texts do not fit the GEO answer budget (12.000 Tokens) and are refused up front. */
export const TEXT_TOOL_MAX_TEXT_CHARS = 60_000;
/** `normalizeBlocks` keeps at most this many blocks; a longer upload is refused, not cut. */
export const TEXT_TOOL_MAX_BLOCKS = 40;
export const TEXT_TOOL_ACCEPT = ".txt,.html,.htm,.pdf,.doc,.docx";

export type UploadedDocumentKind = "text" | "html";

export type UploadedDocument = {
  kind: UploadedDocumentKind;
  /** Plain text (kind `text`) or an HTML document / fragment (kind `html`). */
  content: string;
  /** What the file was read as, for the UI („PDF“, „Word“ …); `web` is a page of the crawled website. */
  format: "txt" | "html" | "pdf" | "docx" | "web";
};

export type IngestResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type IngestedText = {
  blocks: ContentTextBlock[];
  /** `<title>` of an HTML upload, otherwise null (the H1 stays in the first block). */
  title: string | null;
  /** `<meta name="description">` of an HTML upload, otherwise null. */
  metaDescription: string | null;
  /** Plain characters of the body, for the limit check and the UI. */
  chars: number;
};

// --- stage 1: bytes → document -----------------------------------------------------------------

function extension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^﻿/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^﻿/, "");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(bytes, { mergePages: true });
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
}

/** Word → HTML keeps the heading levels and lists, which the block split needs. */
async function extractDocxHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return result.value ?? "";
}

/**
 * Reads the file by its extension (the browser's MIME type is unreliable for .docx and
 * .txt) and checks the header where the format has one. Every failure is a German message
 * the person can act on.
 */
export async function extractUploadedDocument(
  fileName: string,
  bytes: Uint8Array,
): Promise<IngestResult<UploadedDocument>> {
  if (bytes.byteLength === 0) return { ok: false, message: `„${fileName}“ ist leer.` };
  if (bytes.byteLength > TEXT_TOOL_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `„${fileName}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`,
    };
  }
  const ext = extension(fileName);

  if (ext === "pdf" || (!ext && looksLikePdf(bytes))) {
    if (!looksLikePdf(bytes)) return { ok: false, message: `„${fileName}“ ist keine PDF-Datei.` };
    try {
      const text = await extractPdf(bytes);
      if (!text.trim()) {
        return {
          ok: false,
          message: `Das PDF „${fileName}“ enthält keinen auswählbaren Text (Scan oder Bild). Bitte den Text als .txt, .html oder .docx hochladen.`,
        };
      }
      return { ok: true, value: { kind: "text", content: text, format: "pdf" } };
    } catch {
      return { ok: false, message: `Das PDF „${fileName}“ konnte nicht gelesen werden.` };
    }
  }

  if (ext === "docx" || ext === "doc") {
    if (!looksLikeZip(bytes)) {
      return {
        ok: false,
        message:
          ext === "doc"
            ? `„${fileName}“ ist das alte Word-Format (.doc). Bitte in Word als .docx speichern und erneut hochladen.`
            : `„${fileName}“ ist keine Word-Datei (.docx).`,
      };
    }
    try {
      const html = await extractDocxHtml(bytes);
      if (!html.trim()) return { ok: false, message: `Die Word-Datei „${fileName}“ enthält keinen Text.` };
      return { ok: true, value: { kind: "html", content: html, format: "docx" } };
    } catch {
      return { ok: false, message: `Die Word-Datei „${fileName}“ konnte nicht gelesen werden.` };
    }
  }

  if (ext === "html" || ext === "htm") {
    return { ok: true, value: { kind: "html", content: decodeText(bytes), format: "html" } };
  }

  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "text") {
    return { ok: true, value: { kind: "text", content: decodeText(bytes), format: "txt" } };
  }

  return {
    ok: false,
    message: `„${fileName}“ hat ein unbekanntes Format. Erlaubt sind .txt, .html, .pdf und .docx.`,
  };
}

// --- stage 2: document → blocks ----------------------------------------------------------------

type Draft = { heading: string | null; level: 1 | 2 | 3; parts: string[] };

function newDraft(heading: string | null, level: 1 | 2 | 3): Draft {
  return { heading, level, parts: [] };
}

function headingLevel(tag: number): 1 | 2 | 3 {
  return tag <= 1 ? 1 : tag === 2 ? 2 : 3;
}

/** A block longer than this (plain characters) is split, so `sanitizeBlockHtml` never cuts it. */
const MAX_DRAFT_CHARS = 8_000;

function plainLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").length;
}

/**
 * A draft whose body is longer than `MAX_DRAFT_CHARS` becomes several blocks: the first
 * keeps the heading, the rest are continuation blocks without one (a PDF without any
 * detectable headings would otherwise be one block, silently cut at 12.000 characters).
 * Paragraphs are never split; a single paragraph over the limit stays whole.
 */
function splitLongDrafts(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const draft of drafts) {
    let current: Draft = newDraft(draft.heading, draft.level);
    let length = 0;
    for (const part of draft.parts) {
      const partLength = plainLength(part);
      if (length > 0 && length + partLength > MAX_DRAFT_CHARS) {
        out.push(current);
        current = newDraft(null, 2);
        length = 0;
      }
      current.parts.push(part);
      length += partLength;
    }
    out.push(current);
  }
  return out;
}

type FinishedDrafts = { blocks: ContentTextBlock[]; total: number; chars: number };

/**
 * Drafts → blocks. Ids are `abschnitt-1`, `abschnitt-2`, … in document order: stable
 * across runs of the same upload, and what the GEO prompt tells the model to keep. The
 * first block carries the H1; a document without one gets its first heading promoted, so
 * the output has the one H1 the pipeline expects. Only the first block may be level 1.
 * `total` and `chars` are measured before `normalizeBlocks`, which caps blocks and HTML.
 */
type RawSection = { id: string; heading: string; level: 1 | 2 | 3; html: string };

/**
 * A crawled web page often has more sections than the tools take. Instead of refusing it,
 * sections are folded together until `limit` is met: first every H3 into the section above
 * it (its heading becomes a bold line), then the shortest section into its predecessor.
 * Text is never dropped. The first section (the H1) always stays first.
 */
export function fitSectionsToLimit<T extends RawSection>(sections: readonly T[], limit: number): T[] {
  const out = sections.map((s) => ({ ...s }));
  const fold = (index: number) => {
    const target = out[index - 1]!;
    const source = out[index]!;
    const heading = source.heading ? `<p><strong>${escapeHtml(source.heading)}</strong></p>` : "";
    target.html = [target.html, heading, source.html].filter(Boolean).join("\n");
    out.splice(index, 1);
  };
  for (let i = out.length - 1; i >= 1 && out.length > limit; i -= 1) {
    if (out[i]!.level === 3) fold(i);
  }
  while (out.length > limit && out.length > 1) {
    let shortest = 1;
    for (let i = 2; i < out.length; i += 1) {
      if (plainLength(out[i]!.html) + out[i]!.heading.length < plainLength(out[shortest]!.html) + out[shortest]!.heading.length) shortest = i;
    }
    fold(shortest);
  }
  return out.map((s, index) => ({ ...s, id: `abschnitt-${index + 1}` }));
}

/**
 * On a web page, teaser text or breadcrumbs often come before the H1. The tools need the H1
 * first, so the first H1 section moves to the front; everything else keeps its order.
 */
export function h1First<T extends { heading: string | null; level: 1 | 2 | 3 }>(sections: readonly T[]): T[] {
  const index = sections.findIndex((s) => s.level === 1 && s.heading);
  if (index <= 0) return [...sections];
  return [sections[index]!, ...sections.slice(0, index), ...sections.slice(index + 1)];
}

function finishDrafts(drafts: Draft[], options: { fit?: boolean } = {}): FinishedDrafts {
  const split = splitLongDrafts(drafts)
    .map((d) => ({ ...d, html: d.parts.join("\n").trim() }))
    .filter((d) => d.heading || d.html);
  const filled = options.fit ? h1First(split) : split;
  const hasH1 = filled.some((d) => d.level === 1 && d.heading);
  const raw = filled.map((d, index) => {
    let level: 1 | 2 | 3 = d.level;
    if (index === 0) {
      // Promote the first heading when nothing in the document is an H1.
      if (!hasH1 && d.heading) level = 1;
    } else if (level === 1) {
      // A second H1 cannot stay one; the first block already holds the page title.
      level = 2;
    }
    return { id: `abschnitt-${index + 1}`, heading: d.heading ?? "", level, html: d.html };
  });
  const sections = options.fit && raw.length > TEXT_TOOL_MAX_BLOCKS ? fitSectionsToLimit(raw, TEXT_TOOL_MAX_BLOCKS) : raw;
  const chars = sections.reduce((sum, b) => sum + b.heading.length + plainLength(b.html), 0);
  // `normalizeBlocks` sanitizes the HTML again and fixes empty ids/levels like LLM output.
  return { blocks: normalizeBlocks(sections), total: sections.length, chars };
}

function cleanHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

// --- HTML ---------------------------------------------------------------------------------------

/** Elements whose content is never page text. */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "nav", "header", "footer", "form", "button"]);
/** Elements that become body HTML of the current block as they are (sanitized). */
const CONTENT_TAGS = new Set(["p", "ul", "ol", "blockquote", "pre"]);
/** Containers to descend into; their own tag is dropped. */
const CONTAINER_TAGS = new Set(["body", "html", "main", "article", "section", "div", "figure", "figcaption", "details", "summary", "center", "span"]);
const HEADING_RE = /^h([1-6])$/;

/**
 * HTML → blocks, document order: every H1–H6 starts a block (H1 → 1, H2 → 2, H3–H6 → 3),
 * paragraphs, lists and quotes land in the block that is open, text that lies loose in a
 * container (a `<div>` with bare text, inline runs) becomes a paragraph, and a table becomes
 * one paragraph per row with „ | “ between the cells. Navigation, header, footer, forms and
 * scripts are not text and are skipped. Text before the first heading is a block without
 * heading (the intro).
 */
function htmlToDrafts(html: string): { drafts: Draft[]; title: string | null; metaDescription: string | null } {
  const $ = cheerio.load(html);
  const drafts: Draft[] = [newDraft(null, 2)];
  let inline: string[] = [];

  const current = () => drafts[drafts.length - 1]!;
  const flushInline = () => {
    const text = inline.join("").trim();
    inline = [];
    if (!text) return;
    const clean = sanitizeBlockHtml(text);
    if (clean.replace(/<[^>]+>/g, "").trim()) current().parts.push(`<p>${clean}</p>`);
  };

  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      const text = node.data.replace(/\s+/g, " ");
      if (text.trim()) inline.push(escapeHtml(text));
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    const heading = tag.match(HEADING_RE);
    if (heading) {
      flushInline();
      drafts.push(newDraft(cleanHeading($(el).text()) || null, headingLevel(Number(heading[1]))));
      return;
    }
    if (CONTENT_TAGS.has(tag)) {
      flushInline();
      const clean = sanitizeBlockHtml($.html(el));
      if (clean.replace(/<[^>]+>/g, "").trim()) current().parts.push(clean);
      return;
    }
    if (tag === "table") {
      flushInline();
      $(el)
        .find("tr")
        .each((_, row) => {
          const cells = $(row)
            .find("th, td")
            .map((_i, cell) => $(cell).text().replace(/\s+/g, " ").trim())
            .get()
            .filter(Boolean);
          if (cells.length > 0) current().parts.push(`<p>${escapeHtml(cells.join(" | "))}</p>`);
        });
      return;
    }
    if (tag === "br" || tag === "hr") {
      flushInline();
      return;
    }
    if (CONTAINER_TAGS.has(tag) || tag === "li" || tag === "td" || tag === "th" || tag === "tr") {
      // A loose list/table cell outside its list/table: its text still counts.
      if (tag !== "span") flushInline();
      for (const child of el.children) walk(child);
      if (tag !== "span") flushInline();
      return;
    }
    // Inline elements (a, strong, em, b, i, code, …): keep their HTML in the running paragraph.
    inline.push(`<${tag}>`);
    for (const child of el.children) walk(child);
    inline.push(`</${tag}>`);
  };

  const root = $("body").length > 0 ? $("body")[0]! : $.root()[0]!;
  for (const child of root.children) walk(child);
  flushInline();

  const title = cleanHeading($("head > title").first().text()) || null;
  const metaDescription =
    cleanHeading($('head > meta[name="description"]').first().attr("content") ?? "").slice(0, 400) || null;
  return { drafts, title, metaDescription };
}

// --- plain text ---------------------------------------------------------------------------------

const MD_HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET_RE = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/;
const ORDERED_RE = /^\s*\d{1,2}[.)]\s+/;
const MAX_HEADING_CHARS = 90;
const MAX_HEADING_WORDS = 14;

/**
 * Plain text has no markup, so headings are guessed. A paragraph (lines between blank
 * lines) is a heading when it is one line and
 *   - starts with `#`, `##` or `###` (Markdown; that sets the level), or
 *   - is underlined by `===` (level 1) or `---` (level 2), or
 *   - is short (≤ 90 characters, ≤ 14 words), does not end like a sentence (no `.`, `;`,
 *     `,` or `:` at the end; `?` and `!` are fine, FAQ headings are questions), is not a
 *     list item and is followed by another paragraph.
 * Guessed headings are level 2; `finishDrafts` promotes the first one to the H1 when the
 * text has none. Lines that start with `-`, `*`, `•` or `1.` form a list; everything else is
 * a paragraph with line breaks kept.
 */
export function isHeadingLikeLine(line: string, hasNext: boolean): boolean {
  const text = line.trim();
  if (!text || !hasNext) return false;
  if (text.length > MAX_HEADING_CHARS) return false;
  if (text.split(/\s+/).length > MAX_HEADING_WORDS) return false;
  if (BULLET_RE.test(text)) return false;
  if (/[.;,:]$/.test(text)) return false;
  // A line that is mostly punctuation or a URL is not a heading.
  if (/^[\W\d_]+$/.test(text) || /^https?:\/\//i.test(text)) return false;
  return true;
}

function listHtml(lines: string[]): string {
  const ordered = lines.every((l) => ORDERED_RE.test(l));
  const items = lines.map((l) => `<li>${escapeHtml(l.replace(BULLET_RE, "").trim())}</li>`).join("");
  return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
}

function textToDrafts(text: string): Draft[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()))
    .filter((lines) => lines.length > 0);

  const drafts: Draft[] = [newDraft(null, 2)];
  const current = () => drafts[drafts.length - 1]!;

  paragraphs.forEach((lines, index) => {
    const hasNext = index < paragraphs.length - 1;
    const first = lines[0]!.trim();

    const md = lines.length === 1 ? first.match(MD_HEADING_RE) : null;
    if (md) {
      drafts.push(newDraft(cleanHeading(md[2]!), headingLevel(md[1]!.length)));
      return;
    }
    const underline = lines.length === 2 ? lines[1]!.trim() : "";
    if (underline && /^(=+|-+)$/.test(underline) && underline.length >= 3) {
      drafts.push(newDraft(cleanHeading(first), underline.startsWith("=") ? 1 : 2));
      return;
    }
    if (lines.length === 1 && isHeadingLikeLine(first, hasNext)) {
      drafts.push(newDraft(cleanHeading(first), 2));
      return;
    }
    if (lines.every((l) => BULLET_RE.test(l))) {
      current().parts.push(listHtml(lines));
      return;
    }
    current().parts.push(`<p>${lines.map((l) => escapeHtml(l.trim())).join("<br>")}</p>`);
  });
  return drafts;
}

// --- entry ---------------------------------------------------------------------------------------

/**
 * Text or HTML → blocks. An HTML export of Texte (`<section data-block-id>`) is taken back
 * as it is, ids included; any other HTML and all plain text go through the heuristics above.
 */
/**
 * `fitToLimit` (crawled web pages only): more than 40 sections are folded together instead of
 * refused (`fitSectionsToLimit`). Uploads keep the strict limit, so a person decides there.
 */
export function blocksFromDocument(
  doc: Pick<UploadedDocument, "kind" | "content">,
  options: { fitToLimit?: boolean } = {},
): IngestResult<IngestedText> {
  const fit = { fit: options.fitToLimit === true };
  let finished: FinishedDrafts;
  let title: string | null = null;
  let metaDescription: string | null = null;

  if (doc.kind === "html") {
    const sections = parseBlocksFromHtml(doc.content);
    if (sections.length > 0) {
      finished = {
        blocks: sections,
        total: sections.length,
        chars: sections.reduce((sum, b) => sum + (b.heading?.length ?? 0) + plainLength(b.html), 0),
      };
      const $ = cheerio.load(doc.content);
      title = cleanHeading($("head > title").first().text()) || null;
      metaDescription = cleanHeading($('head > meta[name="description"]').first().attr("content") ?? "") || null;
    } else {
      const parsed = htmlToDrafts(doc.content);
      finished = finishDrafts(parsed.drafts, fit);
      title = parsed.title;
      metaDescription = parsed.metaDescription;
    }
  } else {
    finished = finishDrafts(textToDrafts(doc.content), fit);
  }

  const { blocks, total, chars } = finished;
  if (blocks.length === 0) {
    return { ok: false, message: "In der Datei wurde kein Text gefunden." };
  }
  if (chars > TEXT_TOOL_MAX_TEXT_CHARS) {
    return {
      ok: false,
      message: `Der Text ist zu lang (${chars.toLocaleString("de-DE")} Zeichen, erlaubt sind ${TEXT_TOOL_MAX_TEXT_CHARS.toLocaleString("de-DE")}). Bitte den Text aufteilen.`,
    };
  }
  if (total > TEXT_TOOL_MAX_BLOCKS) {
    return {
      ok: false,
      message: `Der Text hat ${total} Abschnitte, erlaubt sind höchstens ${TEXT_TOOL_MAX_BLOCKS}. Bitte den Text aufteilen oder Zwischenüberschriften zusammenfassen.`,
    };
  }
  return { ok: true, value: { blocks, title, metaDescription, chars } };
}
