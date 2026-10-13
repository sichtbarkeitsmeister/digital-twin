import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadContentAnbieterSources } from "@/lib/dt/content/load-sources";
import { loadContentSettings } from "@/lib/dt/content/store";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";
import {
  SEO_TOOL_JOB_KIND,
  SEO_TOOL_MAX_ANALYSE_CHARS,
  SEO_TOOL_MAX_KI_PROMPT_CHARS,
  SEO_TOOL_MAX_LIST_CHARS,
  SEO_TOOL_MAX_NOTES_CHARS,
  isSeoToolPageType,
  materialTextFromBlocks,
  parseAnalyseJson,
  seoToolPayloadSchema,
  splitSeoKeywords,
  splitSeoLines,
  splitSeoNotes,
  type SeoToolStartResult,
} from "@/lib/dt/text-tools/seo";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { enqueueJob } from "@/lib/jobs/queue";

/** Reading a PDF or Word file can take a moment; the model calls themselves run in the job. */
export const maxDuration = 60;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * SEO tool: briefing + optional upload → one `text-tool.seo` job (step 1 and step 2 of
 * Texte for a page that has no row). Multipart form: `pageName`, `pageType`, optional
 * `file` (.txt, .html, .pdf, .docx), `pillarName`, `mainKeyword`, `secondaryKeywords`,
 * `h1Options`, `userQuestions`, `linkTargets`, `kiPrompt`, `notes`, `analyse`; the
 * organisation comes as `organisationId` field or `?org=`.
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

  const analyse = parseAnalyseJson(field(form, "analyse", SEO_TOOL_MAX_ANALYSE_CHARS + 1));
  if (!analyse.ok) return contentError(analyse.message, 400);

  const file = form.get("file");
  if (file instanceof File && file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  try {
    const [settings, anbieter] = await Promise.all([
      loadContentSettings(gate.service, gate.organisationId),
      loadContentAnbieterSources(gate.service, gate.organisationId),
    ]);
    if (!settings) {
      return contentError("Die Einstellungen für Texte sind für diese Organisation noch nicht bestätigt. Bitte zuerst unter Texte bestätigen.", 400);
    }
    if (anbieter.sections.length === 0) {
      return contentError("Keine Anbieterfakten vorhanden (weder Anbieter-Fragebogen noch ausgewertete Gespräche). Ohne Fakten schreibt der SEO-Schritt nur Platzhalter.", 400);
    }
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Einstellungen konnten nicht geladen werden.", 500);
  }

  let input: SeoToolStartResult["input"] = null;
  let material: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!document.ok) return contentError(document.message, 400);
    const ingested = blocksFromDocument(document.value);
    if (!ingested.ok) return contentError(ingested.message, 400);
    material = materialTextFromBlocks(ingested.value.blocks);
    fileName = file.name.slice(0, 260);
    input = { blocks: ingested.value.blocks.length, chars: ingested.value.chars, format: document.value.format };
  }

  const payload = seoToolPayloadSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    pageName,
    pageType,
    pillarName: field(form, "pillarName", 200).trim() || null,
    mainKeyword: field(form, "mainKeyword", 120).trim() || null,
    secondaryKeywords: splitSeoKeywords(field(form, "secondaryKeywords", SEO_TOOL_MAX_LIST_CHARS)),
    h1Options: splitSeoLines(field(form, "h1Options", SEO_TOOL_MAX_LIST_CHARS), { max: 10, maxChars: 200 }),
    userQuestions: splitSeoLines(field(form, "userQuestions", SEO_TOOL_MAX_LIST_CHARS), { max: 40, maxChars: 400 }),
    linkTargets: splitSeoLines(field(form, "linkTargets", SEO_TOOL_MAX_LIST_CHARS), { max: 40, maxChars: 200 }),
    kiPrompt: field(form, "kiPrompt", SEO_TOOL_MAX_KI_PROMPT_CHARS).trim() || null,
    notes: splitSeoNotes(field(form, "notes", SEO_TOOL_MAX_NOTES_CHARS * 5)),
    fileName,
    material,
    analyse: analyse.value,
  });
  if (!payload.success) return contentError("Das Briefing konnte nicht für die Verarbeitung vorbereitet werden.", 400);

  const job = await enqueueJob({
    kind: SEO_TOOL_JOB_KIND,
    organisationId: gate.organisationId,
    payload: payload.data,
    maxAttempts: 3,
  });
  if (!job.ok || !job.jobId) return contentError(`Die Verarbeitung konnte nicht gestartet werden: ${job.ok ? "kein Job" : job.error}`, 500);

  kickJobsWorker(1);
  const data: SeoToolStartResult = {
    id: job.jobId,
    status_url: `/api/dt/text-tools/seo/jobs/${job.jobId}`,
    input,
    analyse_source: analyse.value != null ? "pasted" : "model",
  };
  return contentOk(data, 202);
}
