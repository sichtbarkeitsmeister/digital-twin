import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { ContentLlmError, llmErrorMessage } from "@/lib/dt/content/pipeline/llm";
import { readTextToolInput } from "@/lib/dt/text-tools/tool-input";
import { isSeoToolPageType, materialTextFromBlocks, runSeoTool, seoToolRequestSchema } from "@/lib/dt/text-tools/seo";

/** One Claude call writes the whole page (up to 12.000 tokens); the model gets 270 s of it. */
export const maxDuration = 300;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * SEO tool: page name, page type, avatar and an optional file → the finished page text in
 * the answer. No job, nothing stored. Multipart form: `pageName`, `pageType`, optional
 * `avatarId` and `file` (.txt, .html, .pdf, .docx) or `crawlUrl` (a page of the organisation's crawl); the organisation comes as
 * `organisationId` field or `?org=`.
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

  const pageName = field(form, "pageName", 200).trim();
  if (!pageName) return contentError("Bitte einen Seitennamen eingeben.", 400);
  const pageType = field(form, "pageType", 40).trim();
  if (!isSeoToolPageType(pageType)) return contentError("Bitte einen Seitentyp wählen.", 400);

  const input = await readTextToolInput(form, gate.service, gate.organisationId);
  if (!input.ok) return contentError(input.message, 400);
  const material = input.value ? materialTextFromBlocks(input.value.ingested.blocks) : null;
  const fileName = input.value?.fileName ?? null;

  const request = seoToolRequestSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    pageName,
    pageType,
    avatarId: field(form, "avatarId", 80).trim() || null,
    fileName,
    material,
  });
  if (!request.success) return contentError("Die Angaben konnten nicht für die Verarbeitung vorbereitet werden.", 400);

  try {
    return contentOk(await runSeoTool(gate.service, request.data));
  } catch (error) {
    console.error("[text-tool.seo] run failed:", error);
    if (error instanceof ContentLlmError) return contentError(error.message, error.retryable ? 503 : 400);
    return contentError(llmErrorMessage(error), 502);
  }
}
