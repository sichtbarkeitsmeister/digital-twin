import { z } from "zod";

import {
  briefingFromStructureTree,
  briefingToStructureText,
  parseContentStructureWorkbook,
  summariseBriefing,
  type ContentBriefingPage,
} from "@/lib/dt/content/excel-structure";
import { loadContentOverview } from "@/lib/dt/content/overview";
import {
  contentError,
  contentOk,
  gateContentRoute,
  loadContentCityCandidates,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { upsertContentPagesFromBriefing } from "@/lib/dt/content/store";
import type { ContentStructureUploadResult } from "@/lib/dt/content/types";
import {
  clipWebsiteStructureRaw,
  parseWebsiteStructure,
  sanitizeWebsiteStructureText,
} from "@/lib/dt/seo/website-structure";

export const maxDuration = 120;

const cellSchema = z.union([z.string().max(5_000), z.number(), z.boolean(), z.null()]);
const sheetSchema = z.object({
  name: z.string().max(200),
  rows: z.array(z.array(cellSchema).max(60)).max(3_000),
});
const bodySchema = z
  .object({
    organisationId: z.string().uuid(),
    filename: z.string().trim().max(240).nullable().optional(),
    mimeType: z.string().trim().max(120).nullable().optional(),
    /** Spreadsheet uploads: the sheets as rows of cells (read in the browser). */
    sheets: z.array(sheetSchema).min(1).max(20).optional(),
    /** Every other structure file (.txt, .md, .json, sitemap, .docx): the text. */
    text: z.string().min(1).max(220_000).optional(),
  })
  .refine((body) => Boolean(body.sheets) !== Boolean(body.text), { message: "sheets oder text" });

/**
 * „Seitenstruktur hochladen“ in Texte. The Excel is a briefing: besides name and path every
 * row's keywords, H1 options, real user questions, traffic and KI-Prompt land on
 * `dt_content_pages`. The same pages go to SEO → Struktur as an outline, through the
 * unchanged SEO parser, with the same timestamp, so both tabs show one structure and the
 * overview's structure sync has nothing left to do. Existing pages keep their text.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);
  const body = parsed.data;

  const gated = await gateContentRoute(body.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const cities = await loadContentCityCandidates(gate.service, gate.organisationId);

  let pages: ContentBriefingPage[];
  let layout: ContentStructureUploadResult["layout"];
  let sheet: string | null = null;
  let structureText: string;
  try {
    if (body.sheets) {
      const workbook = parseContentStructureWorkbook(body.sheets, { cities });
      pages = workbook.pages;
      layout = workbook.layout;
      sheet = workbook.sheet;
      structureText = briefingToStructureText(pages);
    } else {
      const text = sanitizeWebsiteStructureText(body.text ?? "");
      pages = briefingFromStructureTree(parseWebsiteStructure(text).nodes, { cities });
      layout = "text";
      structureText = clipWebsiteStructureRaw(text);
    }
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Die Datei konnte nicht gelesen werden.", 400);
  }
  if (pages.length === 0) return contentError("In der Datei wurde keine Seite erkannt.", 400);

  const uploadedAt = new Date().toISOString();
  const filename = body.filename ? sanitizeWebsiteStructureText(body.filename).trim() || null : null;

  // SEO → Struktur keeps its own parser and flattening; it only receives the outline text.
  let seoSynced = false;
  try {
    const structure = parseWebsiteStructure(structureText);
    const { error } = await gate.service.from("dt_website_structures").upsert(
      {
        organisation_id: gate.organisationId,
        filename,
        mime_type: body.mimeType?.trim() || null,
        raw_text: clipWebsiteStructureRaw(structureText),
        outline: sanitizeWebsiteStructureText(structure.outline),
        node_count: structure.nodeCount,
        uploaded_at: uploadedAt,
        uploaded_by: gate.userId,
      },
      { onConflict: "organisation_id" },
    );
    if (error) console.warn("[content] SEO structure not updated:", error.message);
    seoSynced = !error;
  } catch (error) {
    console.warn("[content] SEO structure not parsed:", error instanceof Error ? error.message : error);
  }

  try {
    await upsertContentPagesFromBriefing(gate.service, gate.organisationId, pages, uploadedAt, body.sheets ? "briefing" : "structure");
    const overview = await loadContentOverview(gate.service, gate.organisationId);
    const data: ContentStructureUploadResult = {
      filename,
      layout,
      sheet,
      ...summariseBriefing(pages),
      seo_synced: seoSynced,
      overview,
    };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht angelegt werden.", 500);
  }
}
