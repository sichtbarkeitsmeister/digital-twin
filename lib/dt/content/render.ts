/**
 * Text representation of a page: ordered blocks, each rendered as
 * `<section data-block-id="…">` so the drawer can highlight and edit them.
 * Pure functions, safe for client components and tests.
 */

import { parseJsonLenient } from "@/lib/ai/tolerant-json";

export type ContentTextBlock = {
  id: string;
  /** Heading text without tags; null for blocks without a heading. */
  heading: string | null;
  /** 1 only for the first block (page title), otherwise 2, 3 or 4. */
  level: 1 | 2 | 3 | 4;
  /** Body HTML (paragraphs, lists, emphasis). Never contains the heading. */
  html: string;
};

const BLOCK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "b", "i", "br", "a", "blockquote"]);
/**
 * The most Abschnitte a text may have. It was 40, and a model answer with more was cut after
 * the 40th without a word: an Unterseite with many H3/H4 ended in the middle (10.11.). Now an
 * answer over the limit is an error (`ContentBlockLimitError`), never a shorter text.
 */
export const CONTENT_MAX_BLOCKS = 120;
export const CONTENT_TOO_MANY_BLOCKS_MESSAGE = "Zu viele Abschnitte (Grenze erreicht)";

/**
 * A model answer over one of the text's limits (number of Abschnitte, size of one Abschnitt).
 * The step fails with the message; a part of the answer is never saved as the text.
 */
export class ContentTextLimitError extends Error {}

/** A text with more Abschnitte than `CONTENT_MAX_BLOCKS`: the step fails instead of saving a part of it. */
export class ContentBlockLimitError extends ContentTextLimitError {
  /** How many usable Abschnitte the answer had. */
  readonly count: number;

  constructor(count: number) {
    super(`${CONTENT_TOO_MANY_BLOCKS_MESSAGE}: ${count} Abschnitte geliefert, höchstens ${CONTENT_MAX_BLOCKS} erlaubt. Nichts wurde gespeichert.`);
    this.name = "ContentBlockLimitError";
    this.count = count;
  }
}

/**
 * The most HTML one Abschnitt may hold, in characters. It was 12,000, and a longer Abschnitt was
 * cut there without a word (possibly inside a tag or a sentence). Now a longer one is an error
 * (`ContentBlockSizeError`); nothing is shortened.
 */
export const CONTENT_MAX_BLOCK_HTML = 30_000;
export const CONTENT_BLOCK_TOO_LONG_MESSAGE = "Abschnitt zu lang (Grenze erreicht)";

/** How a too long Abschnitt is named in a message: its heading, or its id when it has none. */
export function blockLabel(block: Pick<ContentTextBlock, "id" | "heading">): string {
  return block.heading?.trim() ? `„${block.heading.trim().slice(0, 80)}“` : `mit der id „${block.id}“`;
}

/** An Abschnitt with more HTML than `CONTENT_MAX_BLOCK_HTML`: the step fails instead of cutting it. */
export class ContentBlockSizeError extends ContentTextLimitError {
  readonly blockId: string;
  readonly chars: number;

  constructor(block: Pick<ContentTextBlock, "id" | "heading" | "html">) {
    super(
      `${CONTENT_BLOCK_TOO_LONG_MESSAGE}: Der Abschnitt ${blockLabel(block)} hat ${block.html.length.toLocaleString("de-DE")} Zeichen HTML, höchstens ${CONTENT_MAX_BLOCK_HTML.toLocaleString("de-DE")} erlaubt. Nichts wurde gespeichert.`,
    );
    this.name = "ContentBlockSizeError";
    this.blockId = block.id;
    this.chars = block.html.length;
  }
}

/** The first Abschnitt over `CONTENT_MAX_BLOCK_HTML`, or null. */
export function oversizedBlock<T extends Pick<ContentTextBlock, "html">>(blocks: readonly T[]): T | null {
  return blocks.find((b) => b.html.length > CONTENT_MAX_BLOCK_HTML) ?? null;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Keeps paragraphs, lists and emphasis; drops every other tag, every attribute except `href`
 * on links, and script/style bodies. LLM output is not trusted HTML.
 */
export function sanitizeBlockHtml(html: string): string {
  const withoutDangerous = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const cleaned = withoutDangerous.replace(
    /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi,
    (match, rawTag: string, attrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      const closing = match.startsWith("</");
      if (closing) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag === "a") {
        const href = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "";
        const safe = /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(href) ? href : "";
        return safe ? `<a href="${escapeHtml(safe)}">` : "<a>";
      }
      return `<${tag}>`;
    },
  );
  // Never shortened here: a cut could end inside a tag or a sentence. `normalizeBlocks` checks the size.
  return cleaned.replace(/\s+\n/g, "\n").trim();
}

/** Plain text (one paragraph per blank line) → paragraph HTML. */
export function textToParagraphsHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function uniqueId(base: string, used: Set<string>): string {
  let id = BLOCK_ID_RE.test(base) ? base : slugify(base) || "abschnitt";
  if (!BLOCK_ID_RE.test(id)) id = "abschnitt";
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}-${n++}`;
  used.add(candidate);
  return candidate;
}

/**
 * LLM JSON → blocks. Accepts `{id, heading, level, html}` or `{id, heading, text}`; drops
 * empty blocks, fixes ids and levels, sanitizes HTML. Returns [] when nothing usable is there.
 * More than `CONTENT_MAX_BLOCKS` usable blocks throw `ContentBlockLimitError`, an Abschnitt with
 * more than `CONTENT_MAX_BLOCK_HTML` characters of HTML throws `ContentBlockSizeError`.
 */
export function normalizeBlocks(input: unknown, options: { overLimit?: "throw" | "cut" } = {}): ContentTextBlock[] {
  // A JSON string instead of the array (a known slip of the model) is read leniently.
  const raw = typeof input === "string" ? parseJsonLenient(input) : input;
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const blocks: ContentTextBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const heading = typeof rec.heading === "string" ? rec.heading.replace(/<[^>]+>/g, "").trim() : "";
    const bodyHtml =
      typeof rec.html === "string" && rec.html.trim()
        ? sanitizeBlockHtml(rec.html)
        : typeof rec.text === "string"
          ? textToParagraphsHtml(rec.text)
          : "";
    if (!heading && !bodyHtml) continue;
    const rawLevel = Number(rec.level);
    const level: ContentTextBlock["level"] =
      blocks.length === 0 && (rawLevel === 1 || !Number.isFinite(rawLevel))
        ? 1
        : rawLevel === 3 || rawLevel === 4
          ? rawLevel
          : 2;
    const idBase = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim().toLowerCase() : heading || "abschnitt";
    blocks.push({ id: uniqueId(idBase, used), heading: heading || null, level, html: bodyHtml });
  }
  // A caller that reports the limits itself (an upload's own checks, with its own messages)
  // gets every Abschnitt whole and the first `CONTENT_MAX_BLOCKS` of them.
  if (options.overLimit === "cut") return blocks.slice(0, CONTENT_MAX_BLOCKS);
  if (blocks.length > CONTENT_MAX_BLOCKS) throw new ContentBlockLimitError(blocks.length);
  const tooLong = oversizedBlock(blocks);
  if (tooLong) throw new ContentBlockSizeError(tooLong);
  return blocks;
}

export function renderBlocksHtml(blocks: readonly ContentTextBlock[]): string {
  return blocks
    .map((b) => {
      const heading = b.heading ? `<h${b.level}>${escapeHtml(b.heading)}</h${b.level}>` : "";
      return `<section data-block-id="${escapeHtml(b.id)}">${heading}${b.html ? `\n${b.html}` : ""}</section>`;
    })
    .join("\n");
}

const SECTION_RE =
  /<section\b[^>]*\bdata-block-id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/section>/gi;

/** Inverse of `renderBlocksHtml`: the stored page HTML back into blocks (edits included). */
export function parseBlocksFromHtml(html: string): ContentTextBlock[] {
  const blocks: ContentTextBlock[] = [];
  const used = new Set<string>();
  for (const match of html.matchAll(SECTION_RE)) {
    const inner = match[2] ?? "";
    const headingMatch = inner.match(/^\s*<h([1-4])>([\s\S]*?)<\/h\1>/i);
    const level = (headingMatch ? Number(headingMatch[1]) : 2) as ContentTextBlock["level"];
    const heading = headingMatch ? decodeEntities(headingMatch[2] ?? "").trim() : null;
    const body = headingMatch ? inner.slice(headingMatch[0].length) : inner;
    blocks.push({
      id: uniqueId(match[1]!.trim(), used),
      heading: heading || null,
      level: level === 1 || level === 3 || level === 4 ? level : 2,
      html: body.trim(),
    });
  }
  return blocks;
}

/**
 * "Abschnitt ändern": the heading stays, the body becomes the given plain text.
 * If the first line repeats the heading it is not duplicated into the body.
 */
export function replaceBlockText(html: string, blockId: string, text: string): string | null {
  const blocks = parseBlocksFromHtml(html);
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index < 0) return null;
  const block = blocks[index]!;
  const lines = text.trim().split("\n");
  const first = lines[0]?.trim() ?? "";
  const body =
    block.heading && first && first.toLowerCase() === block.heading.toLowerCase()
      ? lines.slice(1).join("\n")
      : text;
  blocks[index] = { ...block, html: textToParagraphsHtml(body) };
  return renderBlocksHtml(blocks);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Stored HTML → Markdown for the `.md` export and the review payload. */
export function htmlToMarkdown(html: string): string {
  let out = html.replace(/<section\b[^>]*>|<\/section>/gi, "\n");
  out = out
    .replace(/<h1>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4>([\s\S]*?)<\/h4>/gi, "#### $1\n\n")
    .replace(/<ol>([\s\S]*?)<\/ol>/gi, (_, items: string) => {
      let n = 0;
      return `${items.replace(/<li>([\s\S]*?)<\/li>/gi, (_m, li: string) => `${++n}. ${li.trim()}\n`)}\n`;
    })
    .replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?(ul|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<p>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Stored HTML → plain text for the `.txt` export: headings on their own line, a blank line
 * between paragraphs, list items with a dash, links as „Text (Adresse)“, no markup at all.
 */
export function htmlToPlainText(html: string): string {
  let out = html.replace(/<section\b[^>]*>|<\/section>/gi, "\n");
  out = out
    .replace(/<h[1-4]>([\s\S]*?)<\/h[1-4]>/gi, "\n$1\n\n")
    .replace(/<ol>([\s\S]*?)<\/ol>/gi, (_, items: string) => {
      let n = 0;
      return `\n${items.replace(/<li>([\s\S]*?)<\/li>/gi, (_m, li: string) => `${++n}. ${li.trim()}\n`)}\n`;
    })
    .replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?(ul|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<p>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<[^>]+>/g, "");
  return `${decodeEntities(out)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

export function fullHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>\n<html lang="de">\n<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`;
}

/** Text the LLM reads in later steps: headings as Markdown, body as plain text. */
export function blocksToPromptText(blocks: readonly ContentTextBlock[]): string {
  return blocks
    .map((b) => {
      const heading = b.heading ? `${"#".repeat(b.level)} ${b.heading}\n` : "";
      return `[Abschnitt ${b.id}]\n${heading}${htmlToMarkdown(b.html)}`.trim();
    })
    .join("\n\n");
}
