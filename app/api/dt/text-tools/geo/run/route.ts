import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { geoToolRequestSchema, runGeoTool } from "@/lib/dt/text-tools/geo";
import { TEXT_TOOL_MISSING_INPUT_MESSAGE, readTextToolInput } from "@/lib/dt/text-tools/tool-input";

/** One Claude call rewrites the whole text (up to 12.000 tokens); the model gets 270 s of it. */
export const maxDuration = 300;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * GEO tool: a file, an optional page name and an avatar → the reworked text in the answer.
 * No job, nothing stored. Multipart form: `file` (.txt, .html, .pdf, .docx) or `crawlUrl` (a page of the organisation's crawl), optional
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

  const input = await readTextToolInput(form, gate.service, gate.organisationId);
  if (!input.ok) return contentError(input.message, 400);
  if (!input.value) return contentError(TEXT_TOOL_MISSING_INPUT_MESSAGE, 400);
  const { ingested } = input.value;

  const request = geoToolRequestSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    fileName: input.value.fileName,
    pageName: field(form, "pageName", 200).trim() || input.value.crawledPageName,
    avatarId: field(form, "avatarId", 80).trim() || null,
    blocks: ingested.blocks,
    title: ingested.title,
    metaDescription: ingested.metaDescription,
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
