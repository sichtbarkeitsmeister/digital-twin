import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { geoToolRequestSchema, runGeoTool } from "@/lib/dt/text-tools/geo";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";

/** One Claude call rewrites the whole text (up to 12.000 tokens); the model gets 270 s of it. */
export const maxDuration = 300;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * GEO tool: a file, an optional page name and an avatar → the reworked text in the answer.
 * No job, nothing stored. Multipart form: `file` (.txt, .html, .pdf, .docx), optional
 * `pageName` and `avatarId`; the organisation comes as `organisationId` field or `?org=`.
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

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return contentError("Bitte eine Datei auswählen (.txt, .html, .pdf oder .docx).", 400);
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!document.ok) return contentError(document.message, 400);
  const ingested = blocksFromDocument(document.value);
  if (!ingested.ok) return contentError(ingested.message, 400);

  const request = geoToolRequestSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    fileName: file.name.slice(0, 260),
    pageName: field(form, "pageName", 200).trim() || null,
    avatarId: field(form, "avatarId", 80).trim() || null,
    blocks: ingested.value.blocks,
    title: ingested.value.title,
    metaDescription: ingested.value.metaDescription,
  });
  if (!request.success) return contentError("Der Text konnte nicht für die Verarbeitung vorbereitet werden.", 400);

  try {
    return contentOk(await runGeoTool(gate.service, request.data));
  } catch (error) {
    console.error("[text-tool.geo] run failed:", error);
    if (error instanceof ContentLlmError) return contentError(error.message, error.retryable ? 503 : 400);
    return contentError(llmErrorMessage(error), 502);
  }
}
