/**
 * The finished Watermark text as a file, built in the browser: the uploaded sections with
 * their rewritten bodies, rendered and exported like a Texte page (`contentExportFile`).
 * Pure and client-safe (no model client, no server imports).
 */

import { contentExportFile, type ContentExportFile } from "@/lib/dt/content/export";
import { renderBlocksHtml, slugify, type ContentTextBlock } from "@/lib/dt/content/render";

export type WatermarkExportFormat = "html" | "txt";

/** Every block with its rewritten body when there is one; same rule as `rephrasedBlocks` of step 8. */
export function mergeWatermarkBlocks(blocks: readonly ContentTextBlock[], rewritten: Readonly<Record<string, string>>): ContentTextBlock[] {
  return blocks.map((block) => (rewritten[block.id]?.trim() ? { ...block, html: rewritten[block.id]! } : block));
}

/** „leistungen.docx“ → „leistungen-ueberarbeitet.html“ / „.txt“. */
export function watermarkExportFile(
  format: WatermarkExportFormat,
  input: { fileName: string; title: string | null; blocks: readonly ContentTextBlock[] },
): ContentExportFile {
  const base = input.fileName.replace(/\.[a-z0-9]+$/i, "").trim() || "text";
  return contentExportFile(format, {
    slug: `${slugify(base) || "text"}-ueberarbeitet`,
    title: input.title || base,
    html: renderBlocksHtml(input.blocks),
  });
}
