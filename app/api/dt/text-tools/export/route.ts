import { z } from "zod";

import { normalizeBlocks } from "@/lib/dt/content/render";
import { gateTextToolsRoute, readTextToolsJsonBody, textToolsError } from "@/lib/dt/text-tools/access";
import {
  buildTextToolsExport,
  TEXT_TOOLS_EXPORT_FORMATS,
  textToolsExportResponse,
} from "@/lib/dt/text-tools/export";
import { isTextToolId } from "@/lib/dt/text-tools/tools";

const blockSchema = z.object({
  id: z.string().max(80).optional(),
  heading: z.string().max(500).nullable().optional(),
  level: z.number().int().min(1).max(3).optional(),
  html: z.string().max(20_000).optional(),
  text: z.string().max(20_000).optional(),
});

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  tool: z.string().optional(),
  format: z.enum(TEXT_TOOLS_EXPORT_FORMATS as [string, ...string[]]),
  title: z.string().max(500).nullable().optional(),
  metaDescription: z.string().max(1_000).nullable().optional(),
  blocks: z.array(blockSchema).min(1).max(200),
  /** File name without extension; defaults to the title. */
  baseName: z.string().max(200).nullable().optional(),
  includeMeta: z.boolean().optional(),
});

/**
 * Shared download step of the Textwerkzeuge: the tool's current blocks as HTML, fragment,
 * Markdown or text, rendered exactly like a page export under Texte. Blocks are normalised
 * (ids, levels, sanitised HTML) before rendering, so the client can send what it edited.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readTextToolsJsonBody(req));
  if (!parsed.success) return textToolsError("Ungültige Anfrage.", 400);
  const body = parsed.data;

  const gated = await gateTextToolsRoute(body.organisationId, isTextToolId(body.tool) ? body.tool : undefined);
  if (!gated.ok) return gated.response;

  const blocks = normalizeBlocks(body.blocks);
  if (blocks.length === 0) return textToolsError("Es gibt noch keinen Text zum Exportieren.", 400);

  const format = body.format as (typeof TEXT_TOOLS_EXPORT_FORMATS)[number];
  const file = buildTextToolsExport(
    { title: body.title ?? null, metaDescription: body.metaDescription ?? null, blocks },
    format,
    { baseName: body.baseName, includeMeta: body.includeMeta },
  );
  return textToolsExportResponse(file);
}
