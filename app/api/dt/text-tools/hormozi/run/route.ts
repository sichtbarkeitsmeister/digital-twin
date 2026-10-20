import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { hormoziToolRequestSchema, runHormoziTool } from "@/lib/dt/text-tools/hormozi";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";
import { isSeoToolPageType } from "@/lib/dt/text-tools/seo";

/** One Claude call rewrites the whole text (up to 12.000 tokens); the model gets 270 s of it. */
export const maxDuration = 300;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Hormozi tool: a file, an optional page name, a page type and an avatar → the text with the
 * conversion layer and the Hormozi building blocks in the answer. No job, nothing stored.
 * Multipart form: `file` (.txt, .html, .pdf, .docx), `pageType`, `avatarId`, optional
 * `pageName`; the organisation comes as `organisationId` field or `?org=`.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return contentError("Ungültige Anfrage (kein Formular).", 400);
  }

  const gated = await gateContentRoute(field(form, "organisationId", 80) || new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const pageType = field(form, "pageType", 40).trim();
  if (!isSeoToolPageType(pageType)) return contentError("Bitte einen Seitentyp wählen.", 400);
  const avatarId = field(form, "avatarId", 80).trim();
  if (!avatarId) return contentError("Bitte einen Avatar wählen.", 400);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return contentError("Bitte eine Datei auswählen (.txt, .html, .pdf oder .docx).", 400);
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!document.ok) return contentError(document.message, 400);
  const ingested = blocksFromDocument(document.value);
  if (!ingested.ok) return contentError(ingested.message, 400);

  const request = hormoziToolRequestSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    fileName: file.name.slice(0, 260),
    pageName: field(form, "pageName", 200).trim() || null,
    pageType,
    avatarId,
    blocks: ingested.value.blocks,
    title: ingested.value.title,
    metaDescription: ingested.value.metaDescription,
  });
  if (!request.success) return contentError("Der Text konnte nicht für die Verarbeitung vorbereitet werden.", 400);

  try {
    return contentOk(await runHormoziTool(gate.service, request.data));
  } catch (error) {
    console.error("[text-tool.hormozi] run failed:", error);
    if (error instanceof ContentLlmError) return contentError(error.message, error.retryable ? 503 : 400);
    return contentError(llmErrorMessage(error), 502);
  }
}
