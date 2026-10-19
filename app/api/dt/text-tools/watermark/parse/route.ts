import { contentError, contentOk, gateContentAgencyRoute } from "@/lib/dt/content/route-helpers";
import { XAI_MISSING_KEY_MESSAGE, resolveXaiApiKey } from "@/lib/dt/content/pipeline/xai";
import { TEXT_TOOL_MAX_FILE_BYTES, blocksFromDocument, extractUploadedDocument } from "@/lib/dt/text-tools/ingest";
import { prepareWatermarkDocument, type WatermarkDocument } from "@/lib/dt/text-tools/watermark";

/** Reading a PDF or Word file can take a moment. */
export const maxDuration = 60;

/**
 * Watermark tool, first request: the uploaded file (multipart `file`: .txt, .html, .pdf,
 * .docx) → sections and the plan of Grok calls. Stores nothing; the browser keeps the run.
 * Platform admins only, no organisation needed.
 */
export async function POST(req: Request) {
  const gated = await gateContentAgencyRoute();
  if (!gated.ok) return gated.response;

  if (!resolveXaiApiKey()) return contentError(XAI_MISSING_KEY_MESSAGE, 503);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return contentError("Ungültige Anfrage (kein Formular).", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return contentError("Bitte eine Datei auswählen (.txt, .html, .pdf oder .docx).", 400);
  if (file.size > TEXT_TOOL_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_TOOL_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 400);
  }

  const document = await extractUploadedDocument(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!document.ok) return contentError(document.message, 400);
  const ingested = blocksFromDocument(document.value);
  if (!ingested.ok) return contentError(ingested.message, 400);

  const data: WatermarkDocument = prepareWatermarkDocument(file.name.slice(0, 260), document.value.format, ingested.value);
  if (data.total === 0) {
    return contentError("Die Datei enthält keinen Abschnitt mit genug Fließtext zum Umformulieren (Überschriften und Einzeiler bleiben unverändert).", 400);
  }
  return contentOk(data);
}
