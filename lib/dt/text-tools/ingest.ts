/**
 * Uploads and pasted text for the Textwerkzeuge (GEO, SEO, Wasserzeichen) → the block model of
 * Texte (`ContentTextBlock[]`), plus title and meta hints the tools can prefill with.
 *
 * Every format ends in one outline: a heading opens a block, paragraphs, lists and quotes fill
 * it, body HTML goes through the same sanitizer as the Texte pipeline. HTML, Markdown and plain
 * text are parsed here without I/O (testable); .docx (mammoth) and .pdf (unpdf) are decoded on
 * the server first and then take the HTML or text path. Server only (cheerio).
 */

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

import type { TextOutput } from "@/lib/dt/content/pipeline/prompts";
import { escapeHtml, sanitizeBlockHtml, slugify, type ContentTextBlock } from "@/lib/dt/content/render";

export type TextToolsSourceKind = "html" | "docx" | "pdf" | "markdown" | "text";

export type TextToolsHints = {
  /** `<title>`, front matter `title:` or a leading „Titel:“ line; else the first H1, else the first heading. */
  title: string | null;
  /** The first level-1 heading of the document, even when it is not the first block. */
  h1: string | null;
  /** `<meta name="description">`, front matter `description:` or a leading „Meta-Description:“ line. */
  metaDescription: string | null;
};

export type TextToolsIngest = {
  kind: TextToolsSourceKind;
  filename: string | null;
  blocks: ContentTextBlock[];
  hints: TextToolsHints;
  /** What was cut or guessed, in German, for the upload note in the UI. */
  warnings: string[];
};

export const TEXT_TOOLS_MAX_BLOCKS = 120;
export const TEXT_TOOLS_MAX_TEXT_CHARS = 400_000;
export const TEXT_TOOLS_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const TEXT_TOOLS_UPLOAD_ACCEPT = [
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".docx",
  ".pdf",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/pdf",
  WORD_MIME,
].join(",");

export const TEXT_TOOLS_UPLOAD_HINT = "Word (.docx), PDF, HTML, Markdown (.md) oder Text (.txt)";

/** Below the sanitizer's own cap (12 000) so a block is split here instead of cut there. */
const MAX_BLOCK_HTML = 11_000;
const MAX_HEADING = 300;
const BLOCK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

function collapseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasText(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = BLOCK_ID_RE.test(base) ? base : slugify(base);
  if (!BLOCK_ID_RE.test(id)) id = "abschnitt";
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}-${n++}`;
  used.add(candidate);
  return candidate;
}

// --- the outline every format feeds ---------------------------------------------------------

type Draft = { heading: string | null; level: number; parts: string[] };

class Outline {
  private readonly drafts: Draft[] = [];
  private current: Draft | null = null;
  readonly headings: Array<{ text: string; level: number }> = [];

  heading(text: string, level: number): void {
    const clean = collapseSpace(text).slice(0, MAX_HEADING);
    if (!clean) return;
    this.headings.push({ text: clean, level });
    this.current = { heading: clean, level, parts: [] };
    this.drafts.push(this.current);
  }

  /** A fragment beyond the cap is split before the sanitizer, which would otherwise cut it. */
  html(fragment: string): void {
    const pieces = fragment.length > MAX_BLOCK_HTML ? splitLongFragment(fragment) : [fragment];
    for (const piece of pieces) {
      const clean = sanitizeBlockHtml(piece);
      if (!clean || !hasText(clean)) continue;
      if (!this.current) {
        this.current = { heading: null, level: 2, parts: [] };
        this.drafts.push(this.current);
      }
      this.current.parts.push(clean);
    }
  }

  get isEmpty(): boolean {
    return this.drafts.every((d) => !d.heading && d.parts.length === 0);
  }

  finish(): { blocks: ContentTextBlock[]; warnings: string[] } {
    const used = new Set<string>();
    const blocks: ContentTextBlock[] = [];
    let dropped = 0;
    for (const draft of this.drafts) {
      if (!draft.heading && draft.parts.length === 0) continue;
      const chunks = chunkParts(draft.parts);
      chunks.forEach((html, index) => {
        if (blocks.length >= TEXT_TOOLS_MAX_BLOCKS) {
          dropped += 1;
          return;
        }
        const heading = index === 0 ? draft.heading : null;
        const level: ContentTextBlock["level"] = !heading
          ? 2
          : blocks.length === 0 && draft.level === 1
            ? 1
            : draft.level >= 3
              ? 3
              : 2;
        const base = heading ? slugify(heading) : "";
        blocks.push({ id: uniqueId(base || `abschnitt-${blocks.length + 1}`, used), heading, level, html });
      });
    }
    const warnings: string[] = [];
    if (dropped > 0) {
      warnings.push(`Nur die ersten ${TEXT_TOOLS_MAX_BLOCKS} Abschnitte wurden übernommen, ${dropped} weitere nicht.`);
    }
    return { blocks, warnings };
  }
}

/** Joins a block's parts (each already below the cap); the rest continues in headingless blocks. */
function chunkParts(parts: string[]): string[] {
  if (parts.length === 0) return [""];
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + 1 + part.length > MAX_BLOCK_HTML) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current}\n${part}` : part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** A list beyond the cap becomes several lists; anything else loses its markup and is split by sentence. */
function splitLongFragment(html: string): string[] {
  const list = /^\s*<(ul|ol)\b[^>]*>([\s\S]*)<\/\1>\s*$/i.exec(html);
  if (list) {
    const tag = list[1]!.toLowerCase();
    const items = list[2]!.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [];
    const groups: string[] = [];
    let current = "";
    for (const item of items) {
      const safe = item.length > MAX_BLOCK_HTML - 9 ? `<li>${collapseSpace(item.replace(/<[^>]+>/g, " ")).slice(0, MAX_BLOCK_HTML - 20)}</li>` : item;
      if (current && current.length + safe.length > MAX_BLOCK_HTML - 9) {
        groups.push(`<${tag}>${current}</${tag}>`);
        current = safe;
      } else {
        current += safe;
      }
    }
    if (current) groups.push(`<${tag}>${current}</${tag}>`);
    return groups;
  }
  return splitLongParagraph(html);
}

/** One paragraph beyond the cap: markup dropped, sentences regrouped into paragraphs. */
function splitLongParagraph(html: string): string[] {
  const text = collapseSpace(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > MAX_BLOCK_HTML - 7 && current) {
      pieces.push(`<p>${current}</p>`);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(`<p>${current}</p>`);
  return pieces.map((p) => (p.length > MAX_BLOCK_HTML ? p.slice(0, MAX_BLOCK_HTML - 4) + "</p>" : p));
}

function finishIngest(
  kind: TextToolsSourceKind,
  filename: string | null | undefined,
  outline: Outline,
  found: { title: string | null; metaDescription: string | null },
  warnings: string[],
): TextToolsIngest {
  const { blocks, warnings: outlineWarnings } = outline.finish();
  const h1 = outline.headings.find((h) => h.level === 1)?.text ?? null;
  return {
    kind,
    filename: filename?.trim() || null,
    blocks,
    hints: {
      title: found.title ?? h1 ?? outline.headings[0]?.text ?? null,
      h1,
      metaDescription: found.metaDescription,
    },
    warnings: [...warnings, ...outlineWarnings],
  };
}

function clipText(text: string, warnings: string[]): string {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (clean.length <= TEXT_TOOLS_MAX_TEXT_CHARS) return clean;
  warnings.push(`Der Text wurde nach ${TEXT_TOOLS_MAX_TEXT_CHARS.toLocaleString("de-DE")} Zeichen abgeschnitten.`);
  return clean.slice(0, TEXT_TOOLS_MAX_TEXT_CHARS);
}

// --- HTML -----------------------------------------------------------------------------------

const HEADING_TAG_RE = /^h([1-6])$/;
const REMOVE_SELECTOR =
  "script, style, noscript, template, iframe, svg, canvas, nav, footer, aside, form, button, select, input, textarea, [hidden], [aria-hidden='true']";
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "font", "i", "ins", "kbd",
  "label", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);
const MEDIA_TAGS = new Set(["hr", "img", "picture", "video", "audio", "object", "embed", "map"]);

type HtmlWalk = { $: cheerio.CheerioAPI; outline: Outline; inline: string };

function flushInline(ctx: HtmlWalk): void {
  const html = ctx.inline;
  ctx.inline = "";
  if (hasText(html)) ctx.outline.html(`<p>${collapseSpace(html)}</p>`);
}

function walkHtml(nodes: AnyNode[], ctx: HtmlWalk): void {
  for (const node of nodes) {
    if (node.type === "text") {
      ctx.inline += escapeHtml(node.data);
      continue;
    }
    if (node.type !== "tag") continue;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    const heading = HEADING_TAG_RE.exec(tag);
    if (heading) {
      flushInline(ctx);
      ctx.outline.heading(ctx.$(el).text(), Number(heading[1]));
      continue;
    }
    if (tag === "br") {
      ctx.inline += "<br>";
      continue;
    }
    if (MEDIA_TAGS.has(tag)) {
      flushInline(ctx);
      continue;
    }
    if (INLINE_TAGS.has(tag)) {
      ctx.inline += ctx.$.html(el);
      continue;
    }
    flushInline(ctx);
    const $el = ctx.$(el);
    if (tag === "p") {
      ctx.outline.html(`<p>${collapseSpace($el.html() ?? "")}</p>`);
    } else if (tag === "ul" || tag === "ol") {
      ctx.outline.html(collapseSpace(ctx.$.html(el)));
    } else if (tag === "blockquote") {
      ctx.outline.html(`<blockquote>${collapseSpace($el.html() ?? "")}</blockquote>`);
    } else if (tag === "pre") {
      ctx.outline.html(`<p>${escapeHtml($el.text().trim()).replace(/\n/g, "<br>")}</p>`);
    } else if (tag === "table") {
      $el.find("tr").each((_, row) => {
        const cells = ctx
          .$(row)
          .find("th, td")
          .toArray()
          .map((cell) => collapseSpace(ctx.$(cell).text()))
          .filter(Boolean);
        if (cells.length > 0) ctx.outline.html(`<p>${escapeHtml(cells.join(" | "))}</p>`);
      });
    } else {
      walkHtml(el.children, ctx);
      flushInline(ctx);
    }
  }
}

export function ingestHtml(
  html: string,
  options: { filename?: string | null; kind?: TextToolsSourceKind } = {},
): TextToolsIngest {
  const warnings: string[] = [];
  const $ = cheerio.load(clipText(html, warnings));
  const title = collapseSpace($("head > title").first().text() || $("title").first().text()) || null;
  const metaDescription =
    collapseSpace($('meta[name="description"]').first().attr("content") ?? "") ||
    collapseSpace($('meta[property="og:description"]').first().attr("content") ?? "") ||
    null;

  $(REMOVE_SELECTOR).remove();
  $("body > header").remove();
  const main = $("main").first();
  const article = $("article").first();
  const body = $("body");
  const root: cheerio.Cheerio<AnyNode> = main.length ? main : article.length ? article : body.length ? body : $.root();

  const outline = new Outline();
  const ctx: HtmlWalk = { $, outline, inline: "" };
  walkHtml(root.contents().toArray(), ctx);
  flushInline(ctx);

  return finishIngest(options.kind ?? "html", options.filename, outline, { title, metaDescription }, warnings);
}

// --- Markdown and plain text ----------------------------------------------------------------

const ATX_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_H1_RE = /^={2,}\s*$/;
const SETEXT_H2_RE = /^-{2,}\s*$/;
const THEMATIC_BREAK_RE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;
const UL_ITEM_RE = /^\s*[-*+•–]\s+(.*)$/;
const OL_ITEM_RE = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const HINT_LINE_RE =
  /^(titel|title|seitentitel|meta[\s-]?description|meta-beschreibung|meta|description|beschreibung)\s*:\s*(.+)$/i;
const TITLE_KEYS = new Set(["titel", "title", "seitentitel"]);

function hintFromLine(line: string): { key: "title" | "metaDescription"; value: string } | null {
  const match = HINT_LINE_RE.exec(line.trim());
  if (!match) return null;
  const key = match[1]!.toLowerCase();
  const value = collapseSpace(match[2]!).replace(/^["„“]|["“”]$/g, "").trim();
  if (!value) return null;
  return { key: TITLE_KEYS.has(key) ? "title" : "metaDescription", value };
}

/** Escaped text with Markdown emphasis and links as HTML; the sanitizer checks the hrefs later. */
export function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "$1");
}

function stripInlineMarkdown(text: string): string {
  return collapseSpace(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1"),
  );
}

/**
 * A line on its own that reads like a heading: short, no sentence end (a question mark is
 * fine, FAQ headings end with one), not a list item or a hint line.
 */
export function looksLikePlainTextHeading(line: string): boolean {
  const text = line.trim();
  if (text.length < 2 || text.length > 90) return false;
  if (/[.,:;!]$/.test(text)) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (UL_ITEM_RE.test(text) || OL_ITEM_RE.test(text) || QUOTE_RE.test(text)) return false;
  if (HINT_LINE_RE.test(text)) return false;
  return true;
}

/** `"…"` with `\"` and `\\` escapes (what `export.ts` writes), `'…'`, or a bare value. */
function unquoteYaml(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\])/g, "$1").trim();
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'").trim();
  return raw.trim();
}

function parseFrontMatter(lines: string[]): { body: string[]; title: string | null; metaDescription: string | null } {
  if (lines[0]?.trim() !== "---") return { body: lines, title: null, metaDescription: null };
  const end = lines.findIndex((line, index) => index > 0 && index < 60 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { body: lines, title: null, metaDescription: null };
  let title: string | null = null;
  let metaDescription: string | null = null;
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = unquoteYaml(match[2]!.trim());
    if (!value) continue;
    if (key === "title" || key === "titel") title ??= value;
    else if (key === "description" || key === "meta_description" || key === "meta-description" || key === "beschreibung") {
      metaDescription ??= value;
    }
  }
  return { body: lines.slice(end + 1), title, metaDescription };
}

export type MarkdownIngestOptions = {
  filename?: string | null;
  kind?: TextToolsSourceKind;
  /** Treat a short line on its own as a heading (plain text, PDF). Default false. */
  guessHeadings?: boolean;
  /** How consecutive lines of one paragraph are joined. Markdown: space; plain text: `<br>`. */
  softBreak?: "space" | "br";
};

export function ingestMarkdown(text: string, options: MarkdownIngestOptions = {}): TextToolsIngest {
  const warnings: string[] = [];
  const guess = options.guessHeadings ?? false;
  const joiner = options.softBreak === "br" ? "<br>" : " ";
  const front = parseFrontMatter(clipText(text, warnings).split("\n"));
  const lines = front.body;
  let title = front.title;
  let metaDescription = front.metaDescription;

  const outline = new Outline();
  let i = 0;

  // Leading „Titel:“ / „Meta-Description:“ lines are hints, not body text.
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const hint = hintFromLine(line);
    if (!hint) break;
    if (hint.key === "title") title ??= hint.value;
    else metaDescription ??= hint.value;
    i += 1;
  }

  const hasMoreContent = (from: number) => lines.slice(from).some((l) => l.trim());
  const isBlockStart = (line: string) =>
    ATX_HEADING_RE.test(line) ||
    UL_ITEM_RE.test(line) ||
    OL_ITEM_RE.test(line) ||
    QUOTE_RE.test(line) ||
    FENCE_RE.test(line) ||
    THEMATIC_BREAK_RE.test(line);

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const atx = ATX_HEADING_RE.exec(line);
    if (atx) {
      outline.heading(stripInlineMarkdown(atx[2]!), atx[1]!.length);
      i += 1;
      continue;
    }

    const next = lines[i + 1] ?? "";
    if (!isBlockStart(line) && line.trim().length <= 200 && (SETEXT_H1_RE.test(next) || SETEXT_H2_RE.test(next))) {
      outline.heading(stripInlineMarkdown(line), SETEXT_H1_RE.test(next) ? 1 : 2);
      i += 2;
      continue;
    }

    if (THEMATIC_BREAK_RE.test(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) code.push(lines[i++]!);
      i += 1;
      if (code.join("").trim()) outline.html(`<p>${code.map(escapeHtml).join("<br>")}</p>`);
      continue;
    }

    if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
      const ordered = OL_ITEM_RE.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const current = lines[i]!;
        const item = (ordered ? OL_ITEM_RE : UL_ITEM_RE).exec(current) ?? UL_ITEM_RE.exec(current) ?? OL_ITEM_RE.exec(current);
        if (item) items.push(inlineMarkdownToHtml(item[1]!.trim()));
        else if (items.length > 0 && /^\s+\S/.test(current)) items[items.length - 1] += ` ${inlineMarkdownToHtml(current.trim())}`;
        else break;
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      outline.html(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i]!)) quoted.push(QUOTE_RE.exec(lines[i++]!)![1]!);
      const paragraphs = quoted
        .join("\n")
        .split(/\n\s*\n/)
        .map((p) => collapseSpace(p))
        .filter(Boolean)
        .map((p) => `<p>${inlineMarkdownToHtml(p)}</p>`);
      outline.html(`<blockquote>${paragraphs.join("")}</blockquote>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!)) {
      const upcoming = lines[i + 1] ?? "";
      if (paragraph.length > 0 && (SETEXT_H1_RE.test(upcoming) || SETEXT_H2_RE.test(upcoming))) break;
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    if (paragraph.length === 0) {
      i += 1;
      continue;
    }
    if (guess && paragraph.length === 1 && looksLikePlainTextHeading(paragraph[0]!) && hasMoreContent(i)) {
      outline.heading(stripInlineMarkdown(paragraph[0]!), outline.isEmpty ? 1 : 2);
      continue;
    }
    outline.html(`<p>${paragraph.map(inlineMarkdownToHtml).join(joiner)}</p>`);
  }

  if (guess && outline.headings.length > 0) warnings.push("Überschriften wurden aus kurzen Zeilen geschätzt.");

  return finishIngest(options.kind ?? "markdown", options.filename, outline, { title, metaDescription }, warnings);
}

export function ingestPlainText(text: string, options: { filename?: string | null; kind?: TextToolsSourceKind } = {}): TextToolsIngest {
  return ingestMarkdown(text, { ...options, kind: options.kind ?? "text", guessHeadings: true, softBreak: "br" });
}

/** Pasted text: HTML when it carries block tags, Markdown when it uses headings or lists, else plain text. */
export function ingestTextToolsPaste(text: string): TextToolsIngest {
  const trimmed = text.trim();
  if (/<\/?(p|h[1-6]|div|ul|ol|li|br|section|article|html|body|blockquote)\b[^>]*>/i.test(trimmed)) {
    return ingestHtml(trimmed);
  }
  if (/^#{1,6}\s+\S/m.test(trimmed) || /^\s*[-*+]\s+\S/m.test(trimmed) || /\*\*[^*]+\*\*/.test(trimmed)) {
    return ingestMarkdown(trimmed);
  }
  return ingestPlainText(trimmed);
}

// --- uploads --------------------------------------------------------------------------------

function mimeOf(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
}

export function detectTextToolsSourceKind(
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): TextToolsSourceKind | null {
  const name = (filename ?? "").trim().toLowerCase();
  const mime = mimeOf(mimeType);
  if (name.endsWith(".docx") || mime === WORD_MIME) return "docx";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xhtml") || mime === "text/html" || mime === "application/xhtml+xml") {
    return "html";
  }
  if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".mdown") || mime === "text/markdown") return "markdown";
  if (name.endsWith(".txt") || name.endsWith(".text") || mime === "text/plain") return "text";
  if (!name.includes(".") && (!mime || mime.startsWith("text/"))) return "text";
  if (mime.startsWith("text/")) return "text";
  return null;
}

function decodeUploadText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^﻿/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^﻿/, "");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
}

async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return result.value ?? "";
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  // unpdf transfers the buffer to its worker, which empties the caller's array: hand over a copy.
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

const SENTENCE_END_RE = /[.!?:…»“"')\]]$/;

/**
 * PDF text comes as one visual line per row, without blank lines. Rows are regrouped into
 * paragraphs: a row ends one when it is clearly shorter than a full row and ends a sentence,
 * and a short heading-like row at a sentence boundary stands alone (so `ingestMarkdown` with
 * `guessHeadings` can make it a heading).
 */
export function pdfTextToParagraphs(text: string): string {
  const rows = text.replace(/\r\n?/g, "\n").split("\n").map((row) => collapseSpace(row));
  const lengths = rows.filter(Boolean).map((row) => row.length).sort((a, b) => a - b);
  const fullWidth = lengths.length > 0 ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.8))]! : 0;
  const shortRow = (row: string) => fullWidth > 0 && row.length < fullWidth * 0.7;

  const paragraphs: string[] = [];
  let current = "";
  const flush = () => {
    if (current) paragraphs.push(current);
    current = "";
  };
  rows.forEach((row, index) => {
    if (!row) {
      flush();
      return;
    }
    const atBoundary = !current || SENTENCE_END_RE.test(current);
    const hasMore = rows.slice(index + 1).some(Boolean);
    if (atBoundary && hasMore && shortRow(row) && looksLikePlainTextHeading(row)) {
      flush();
      paragraphs.push(row);
      return;
    }
    current = current ? `${current} ${row}` : row;
    if (shortRow(row) && SENTENCE_END_RE.test(row)) flush();
  });
  flush();
  return paragraphs.join("\n\n");
}

export type TextToolsUpload = {
  filename: string;
  mimeType?: string | null;
  bytes: Uint8Array;
};

/** Throws an `Error` with a German message the route can hand to the user as a 400. */
export async function ingestTextToolsBytes(upload: TextToolsUpload): Promise<TextToolsIngest> {
  const name = upload.filename.trim() || "Datei";
  const lower = name.toLowerCase();
  if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
    throw new Error(`„${name}“ ist altes Word-Format (.doc). Bitte als .docx speichern.`);
  }
  const kind = detectTextToolsSourceKind(name, upload.mimeType);
  if (!kind) throw new Error(`„${name}“ wird nicht unterstützt. Bitte ${TEXT_TOOLS_UPLOAD_HINT} hochladen.`);
  if (upload.bytes.byteLength === 0) throw new Error(`„${name}“ ist leer.`);
  if (upload.bytes.byteLength > TEXT_TOOLS_MAX_UPLOAD_BYTES) {
    throw new Error(`„${name}“ ist zu groß (höchstens ${Math.round(TEXT_TOOLS_MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }

  let ingest: TextToolsIngest;
  if (kind === "docx") {
    let html: string;
    try {
      html = await docxToHtml(upload.bytes);
    } catch {
      throw new Error(`„${name}“ konnte nicht gelesen werden. Ist es eine Word-Datei (.docx)?`);
    }
    ingest = ingestHtml(html, { filename: name, kind });
  } else if (kind === "pdf") {
    let text: string;
    try {
      text = await pdfToText(upload.bytes);
    } catch {
      throw new Error(`„${name}“ konnte nicht gelesen werden. Ist es eine PDF-Datei?`);
    }
    if (!text) throw new Error(`„${name}“ enthält keinen auswählbaren Text (Scan oder Bild).`);
    ingest = ingestMarkdown(pdfTextToParagraphs(text), { filename: name, kind, guessHeadings: true, softBreak: "space" });
    ingest.warnings.unshift("Absätze aus dem PDF geschätzt; Zeilenumbrüche des Layouts wurden entfernt.");
  } else {
    const text = decodeUploadText(upload.bytes);
    ingest =
      kind === "html"
        ? ingestHtml(text, { filename: name, kind })
        : kind === "markdown"
          ? ingestMarkdown(text, { filename: name, kind })
          : ingestPlainText(text, { filename: name, kind });
  }

  if (ingest.blocks.length === 0) throw new Error(`„${name}“ enthält keinen lesbaren Text.`);
  return ingest;
}

/** A `File` from `req.formData()` or an `<input type="file">`. */
export async function ingestTextToolsFile(file: File): Promise<TextToolsIngest> {
  return ingestTextToolsBytes({
    filename: file.name,
    mimeType: file.type || null,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
}

/** The ingest in the shape the Texte pipeline and `export.ts` work with. */
export function textToolsIngestToOutput(ingest: TextToolsIngest): TextOutput {
  return { blocks: ingest.blocks, title: ingest.hints.title, meta_description: ingest.hints.metaDescription };
}
