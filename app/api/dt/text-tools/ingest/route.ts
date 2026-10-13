import { z } from "zod";

import {
  gateTextToolsRoute,
  readTextToolsJsonBody,
  textToolsError,
  textToolsOk,
  textToolsOrganisationIdFromRequest,
} from "@/lib/dt/text-tools/access";
import {
  ingestTextToolsFile,
  ingestTextToolsPaste,
  TEXT_TOOLS_MAX_TEXT_CHARS,
  TEXT_TOOLS_MAX_UPLOAD_BYTES,
  type TextToolsIngest,
} from "@/lib/dt/text-tools/ingest";
import { isTextToolId, type TextToolId } from "@/lib/dt/text-tools/tools";

export const maxDuration = 60;

const pasteSchema = z.object({
  organisationId: z.string().uuid(),
  tool: z.string().optional(),
  text: z.string().min(1).max(TEXT_TOOLS_MAX_TEXT_CHARS),
});

function toolFrom(value: unknown): TextToolId | undefined {
  return isTextToolId(value) ? value : undefined;
}

/**
 * Shared upload step of the Textwerkzeuge: `multipart/form-data` with `file` and
 * `organisationId` (optionally `tool`), or JSON `{ organisationId, text }` for pasted text.
 * Answers the blocks and the title/meta hints; nothing is stored.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return textToolsError("Ungültige Anfrage.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return textToolsError("Keine Datei übergeben.", 400);
    if (file.size > TEXT_TOOLS_MAX_UPLOAD_BYTES) {
      return textToolsError(`Die Datei ist zu groß (höchstens ${Math.round(TEXT_TOOLS_MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`, 413);
    }

    const gated = await gateTextToolsRoute(textToolsOrganisationIdFromRequest(req, form), toolFrom(form.get("tool")));
    if (!gated.ok) return gated.response;

    try {
      const ingest = await ingestTextToolsFile(file);
      return textToolsOk<TextToolsIngest>(ingest);
    } catch (error) {
      return textToolsError(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.", 400);
    }
  }

  const parsed = pasteSchema.safeParse(await readTextToolsJsonBody(req));
  if (!parsed.success) return textToolsError("Ungültige Anfrage.", 400);

  const gated = await gateTextToolsRoute(parsed.data.organisationId, toolFrom(parsed.data.tool));
  if (!gated.ok) return gated.response;

  const ingest = ingestTextToolsPaste(parsed.data.text);
  if (ingest.blocks.length === 0) return textToolsError("Der Text enthält keinen lesbaren Inhalt.", 400);
  return textToolsOk<TextToolsIngest>(ingest);
}
