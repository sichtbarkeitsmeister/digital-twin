/**
 * Downloads for the Textwerkzeuge: a full HTML document, the bare fragment, Markdown or plain
 * text from a `TextOutput` (what the Texte pipeline and the tools produce) or from blocks.
 * Rendering is the one from Texte (`render.ts`), so a tool's export reads exactly like a page
 * export under Texte; the file helpers mirror `/api/dt/content/pages/[slug]/export`.
 * Pure functions, safe for client components and tests.
 */

import type { TextOutput } from "@/lib/dt/content/pipeline/prompts";
import { extractContentBlocks, type ContentBlock } from "@/lib/dt/content/presentation";
import {
  fullHtmlDocument,
  htmlToMarkdown,
  htmlToPlainText,
  renderBlocksHtml,
  slugify,
  type ContentTextBlock,
} from "@/lib/dt/content/render";
import type { ContentExportFormat } from "@/lib/dt/content/types";

export type TextToolsDocument = {
  /** The `<title>`; null when only the H1 exists. */
  title: string | null;
  metaDescription: string | null;
  blocks: ContentTextBlock[];
};

export type TextToolsExportFormat = ContentExportFormat;

export const TEXT_TOOLS_EXPORT_FORMATS: readonly TextToolsExportFormat[] = ["html", "fragment", "md", "txt"];

export const TEXT_TOOLS_EXPORT_LABELS: Record<TextToolsExportFormat, string> = {
  html: "HTML exportieren",
  fragment: "HTML-Fragment exportieren",
  md: "Markdown exportieren (.md)",
  txt: "Text exportieren (.txt)",
};

export function isTextToolsExportFormat(value: unknown): value is TextToolsExportFormat {
  return typeof value === "string" && (TEXT_TOOLS_EXPORT_FORMATS as readonly string[]).includes(value);
}

export type TextToolsExportFile = {
  body: string;
  filename: string;
  contentType: string;
};

export type TextToolsExportOptions = {
  /** `.txt` and `.md` only: put title and meta description above the text. Default false. */
  includeMeta?: boolean;
};

/** Accepts the pipeline's `TextOutput` as well as a document; blocks are taken as they are. */
export function textToolsDocument(input: TextOutput | TextToolsDocument): TextToolsDocument {
  if ("meta_description" in input) {
    return { title: input.title, metaDescription: input.meta_description, blocks: input.blocks };
  }
  return input;
}

export function textToolsDocumentFromBlocks(
  blocks: ContentTextBlock[],
  hints: { title?: string | null; metaDescription?: string | null } = {},
): TextToolsDocument {
  return { title: hints.title ?? null, metaDescription: hints.metaDescription ?? null, blocks };
}

export function firstHeading(blocks: readonly ContentTextBlock[]): string | null {
  return blocks.find((b) => b.heading)?.heading ?? null;
}

/** The `<title>` of the export: explicit title, else the first heading, else „Text“. */
export function textToolsDocumentTitle(doc: TextToolsDocument): string {
  return doc.title?.trim() || firstHeading(doc.blocks) || "Text";
}

export function renderTextToolsFragment(doc: TextToolsDocument): string {
  return renderBlocksHtml(doc.blocks);
}

export function renderTextToolsHtml(doc: TextToolsDocument): string {
  return fullHtmlDocument(textToolsDocumentTitle(doc), renderTextToolsFragment(doc), {
    description: doc.metaDescription,
  });
}

function metaLines(doc: TextToolsDocument): string[] {
  const lines: string[] = [];
  if (doc.title?.trim()) lines.push(`Titel: ${doc.title.trim()}`);
  if (doc.metaDescription?.trim()) lines.push(`Meta-Description: ${doc.metaDescription.trim()}`);
  return lines;
}

/** Same text as the Texte `.txt` export; with `includeMeta` the title and meta lines come first. */
export function renderTextToolsPlainText(doc: TextToolsDocument, options: TextToolsExportOptions = {}): string {
  const body = htmlToPlainText(renderTextToolsFragment(doc));
  const meta = options.includeMeta ? metaLines(doc) : [];
  return meta.length > 0 ? `${meta.join("\n")}\n\n${body}` : body;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Markdown like the Texte `.md` export; with `includeMeta` as front matter `ingest.ts` reads back. */
export function renderTextToolsMarkdown(doc: TextToolsDocument, options: TextToolsExportOptions = {}): string {
  const body = htmlToMarkdown(renderTextToolsFragment(doc));
  if (!options.includeMeta) return `${body}\n`;
  const front: string[] = [];
  if (doc.title?.trim()) front.push(`title: ${yamlString(doc.title.trim())}`);
  if (doc.metaDescription?.trim()) front.push(`description: ${yamlString(doc.metaDescription.trim())}`);
  return front.length > 0 ? `---\n${front.join("\n")}\n---\n\n${body}\n` : `${body}\n`;
}

const EXTENSIONS: Record<TextToolsExportFormat, string> = {
  html: "html",
  fragment: "fragment.html",
  md: "md",
  txt: "txt",
};

const CONTENT_TYPES: Record<TextToolsExportFormat, string> = {
  html: "text/html; charset=utf-8",
  fragment: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** `baseName` or the document title as an ASCII file name, umlauts as ae/oe/ue. */
export function textToolsExportFilename(
  format: TextToolsExportFormat,
  baseName: string | null | undefined,
  doc?: TextToolsDocument,
): string {
  const base = slugify(baseName?.trim() || (doc ? textToolsDocumentTitle(doc) : "") || "") || "text";
  return `${base}.${EXTENSIONS[format]}`;
}

export function buildTextToolsExport(
  input: TextOutput | TextToolsDocument,
  format: TextToolsExportFormat,
  options: TextToolsExportOptions & { baseName?: string | null } = {},
): TextToolsExportFile {
  const doc = textToolsDocument(input);
  const body =
    format === "txt"
      ? renderTextToolsPlainText(doc, options)
      : format === "md"
        ? renderTextToolsMarkdown(doc, options)
        : format === "fragment"
          ? renderTextToolsFragment(doc)
          : renderTextToolsHtml(doc);
  return { body, filename: textToolsExportFilename(format, options.baseName, doc), contentType: CONTENT_TYPES[format] };
}

/** `Content-Disposition` value with the file name reduced to safe ASCII, as under Texte. */
export function textToolsAttachmentHeader(filename: string): string {
  return `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`;
}

/** The download response, same headers as the Texte export route. */
export function textToolsExportResponse(file: TextToolsExportFile): Response {
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": textToolsAttachmentHeader(file.filename),
      "Cache-Control": "no-store",
    },
  });
}

// --- for the UI -----------------------------------------------------------------------------

/** Blocks as plain text with their ids, the form the Texte drawer edits (`presentation.ts`). */
export function textToolsEditableBlocks(doc: TextToolsDocument): ContentBlock[] {
  return extractContentBlocks(renderTextToolsFragment(doc));
}

/** Words in headings and bodies, link addresses not counted; what the tools show as „1 234 Wörter“. */
export function textToolsWordCount(blocks: readonly ContentTextBlock[]): number {
  const text = htmlToPlainText(renderBlocksHtml(blocks).replace(/<a\s[^>]*>/gi, "<a>"));
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
