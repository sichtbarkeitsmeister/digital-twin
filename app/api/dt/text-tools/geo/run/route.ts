import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadContentSettings } from "@/lib/dt/content/store";
import {
  GEO_TOOL_JOB_KIND,
  GEO_TOOL_MAX_FAKTENCHECK_CHARS,
  GEO_TOOL_MAX_NOTES_CHARS,
  GEO_TOOL_MAX_QUESTIONS_CHARS,
  geoToolPayloadSchema,
  parseFaktencheckJson,
  splitNotes,
  splitQuestions,
  type GeoToolStartResult,
} from "@/lib/dt/text-tools/geo";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { enqueueJob } from "@/lib/jobs/queue";

/** Reading a PDF or Word file can take a moment; the model call itself runs in the job. */
export const maxDuration = 60;

function field(form: FormData, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * GEO tool: upload + inputs → one `text-tool.geo` job. Multipart form: `file` (.txt, .html,
 * .pdf, .docx), optional `pageName`, `notes`, `questions`, `faktencheck`; the organisation
 * comes as `organisationId` field or `?org=`.
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
  if (!(file instanceof File)) return contentError("Bitte eine Datei auswählen (.txt, .html, .pdf oder .docx).", 400);
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  const faktencheck = parseFaktencheckJson(field(form, "faktencheck", GEO_TOOL_MAX_FAKTENCHECK_CHARS + 1));
  if (!faktencheck.ok) return contentError(faktencheck.message, 400);

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

  const payload = geoToolPayloadSchema.safeParse({
    organisationId: gate.organisationId,
    userId: gate.userId,
    fileName: file.name.slice(0, 260),
    pageName: field(form, "pageName", 200).trim() || null,
    blocks: ingested.value.blocks,
    title: ingested.value.title,
    metaDescription: ingested.value.metaDescription,
    notes: splitNotes(field(form, "notes", GEO_TOOL_MAX_NOTES_CHARS * 5)),
    questions: splitQuestions(field(form, "questions", GEO_TOOL_MAX_QUESTIONS_CHARS)),
    faktencheck: faktencheck.value,
  });
  if (!payload.success) return contentError("Der Text konnte nicht für die Verarbeitung vorbereitet werden.", 400);

  const job = await enqueueJob({
    kind: GEO_TOOL_JOB_KIND,
    organisationId: gate.organisationId,
    payload: payload.data,
    maxAttempts: 3,
  });
  if (!job.ok || !job.jobId) return contentError(`Die Verarbeitung konnte nicht gestartet werden: ${job.ok ? "kein Job" : job.error}`, 500);

  kickJobsWorker(1);
  const data: GeoToolStartResult = {
    id: job.jobId,
    status_url: `/api/dt/text-tools/geo/jobs/${job.jobId}`,
    input: {
      blocks: ingested.value.blocks.length,
      chars: ingested.value.chars,
      title: ingested.value.title,
      format: document.value.format,
    },
  };
  return contentOk(data, 202);
}
