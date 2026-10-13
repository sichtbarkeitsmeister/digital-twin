/**
 * Download of a finished text, shared by the Texte page export and the GEO tool: the same
 * four formats, the same file names, the same headers. Pure except for `Response`.
 */

import { fullHtmlDocument, htmlToMarkdown, htmlToPlainText } from "@/lib/dt/content/render";
import type { ContentExportFormat } from "@/lib/dt/content/types";

export const CONTENT_EXPORT_FORMATS: readonly ContentExportFormat[] = ["html", "fragment", "md", "txt"];

export function isContentExportFormat(value: string | null | undefined): value is ContentExportFormat {
  return CONTENT_EXPORT_FORMATS.includes(value as ContentExportFormat);
}

export type ContentExportSource = {
  /** File name without extension („leistungen“, „geo-2026-10-13“). Unsafe characters are replaced. */
  slug: string;
  /** `<title>` of the full HTML document. */
  title: string;
  /** Stored page HTML (`<section data-block-id>` blocks). */
  html: string;
  /** Markdown when it is already stored; derived from the HTML otherwise. */
  markdown?: string | null;
};

export type ContentExportFile = { body: string; filename: string; contentType: string };

export function contentExportFile(format: ContentExportFormat, source: ContentExportSource): ContentExportFile {
  switch (format) {
    case "txt":
      return { body: htmlToPlainText(source.html), filename: `${source.slug}.txt`, contentType: "text/plain; charset=utf-8" };
    case "md":
      return {
        body: source.markdown?.trim() ? source.markdown : htmlToMarkdown(source.html),
        filename: `${source.slug}.md`,
        contentType: "text/markdown; charset=utf-8",
      };
    case "fragment":
      return { body: source.html, filename: `${source.slug}.fragment.html`, contentType: "text/html; charset=utf-8" };
    default:
      return {
        body: fullHtmlDocument(source.title, source.html),
        filename: `${source.slug}.html`,
        contentType: "text/html; charset=utf-8",
      };
  }
}

export function contentAttachmentDisposition(filename: string): string {
  return `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_")}"`;
}

/** The file as a download response (never cached). */
export function contentExportResponse(file: ContentExportFile): Response {
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": contentAttachmentDisposition(file.filename),
      "Cache-Control": "no-store",
    },
  });
}
