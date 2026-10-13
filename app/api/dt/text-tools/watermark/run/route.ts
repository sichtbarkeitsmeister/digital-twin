import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { rephraseBlockCount } from "@/lib/dt/content/pipeline/rephrase";
import { XAI_MISSING_KEY_MESSAGE, resolveXaiApiKey } from "@/lib/dt/content/pipeline/xai";
import { loadContentSettings } from "@/lib/dt/content/store";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";
import {
  WATERMARK_TOOL_JOB_KIND,
  WATERMARK_TOOL_MAX_NOTES,
  WATERMARK_TOOL_MAX_NOTES_CHARS,
  splitWatermarkNotes,
  watermarkToolPayloadSchema,
  type WatermarkToolStartResult,
} from "@/lib/dt/text-tools/watermark";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { enqueueJob } from "@/lib/jobs/queue";

/** Reading a PDF or Word file can take a moment; the model calls themselves run in the job. */
export const maxDuration = 60;

/** A run of up to 40 sections is many short Grok calls; a transient failure resumes from the saved progress. */
const JOB_MAX_ATTEMPTS = 5;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Watermark tool: upload + notes → one `text-tool.watermark` job. Multipart form: `file`
 * (.txt, .html, .pdf, .docx), optional `pageName`, `notes`; the organisation comes as
 * `organisationId` field or `?org=`. Refused without the Grok key, like step 8 of Texte.
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

  if (!resolveXaiApiKey()) return contentError(XAI_MISSING_KEY_MESSAGE, 400);

  const file = form.get("file");
  if (!(file instanceof File)) return contentError("Bitte eine Datei auswählen (.txt, .html, .pdf oder .docx).", 400);
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  try {
    const settings = await loadContentSettings(gate.service, gate.organisationId);
    if (!settings) {
      return contentError("Die Einstellungen für Texte sind für diese Organisation noch nicht bestätigt. Bitte zuerst unter Texte bestätigen.", 400);
    }
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Einstellungen konnten nicht geladen werden.", 500);
  }

  const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!document.ok) return contentError(document.message, 400);
  const ingested = blocksFromDocument(document.value);
  if (!ingested.ok) return contentError(ingested.message, 400);
  const rewrite = rephraseBlockCount(ingested.value.blocks);
  if (rewrite === 0) {
    return contentError("Die Datei enthält keinen Abschnitt mit genug Fließtext zum Umformulieren (Überschriften und Einzeiler bleiben unverändert).", 400);
  }

  const payload = watermarkToolPayloadSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    fileName: file.name.slice(0, 260),
    pageName: field(form, "pageName", 200).trim() || null,
    blocks: ingested.value.blocks,
    title: ingested.value.title,
    metaDescription: ingested.value.metaDescription,
    notes: splitWatermarkNotes(field(form, "notes", WATERMARK_TOOL_MAX_NOTES_CHARS * WATERMARK_TOOL_MAX_NOTES)),
  });
  if (!payload.success) return contentError("Der Text konnte nicht für die Verarbeitung vorbereitet werden.", 400);

  const job = await enqueueJob({
    kind: WATERMARK_TOOL_JOB_KIND,
    organisationId: gate.organisationId,
    payload: payload.data,
    maxAttempts: JOB_MAX_ATTEMPTS,
  });
  if (!job.ok || !job.jobId) return contentError(`Die Verarbeitung konnte nicht gestartet werden: ${job.ok ? "kein Job" : job.error}`, 500);

  kickJobsWorker(1);
  const data: WatermarkToolStartResult = {
    id: job.jobId,
    status_url: `/api/dt/text-tools/watermark/jobs/${job.jobId}`,
    input: {
      blocks: ingested.value.blocks.length,
      rewrite,
      chars: ingested.value.chars,
      title: ingested.value.title,
      format: document.value.format,
    },
  };
  return contentOk(data, 202);
}
