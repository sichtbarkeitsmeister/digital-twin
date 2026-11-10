import { contentError, contentOk, gateContentRoute } from "@/lib/dt/content/route-helpers";
import { loadTextUploadsResult, storeTextUpload } from "@/lib/dt/content/text-uploads";
import type { ContentTextUploadResult, ContentTextUploadsResult } from "@/lib/dt/content/types";
import { TEXT_UPLOAD_MAX_FILE_BYTES } from "@/lib/dt/content/upload-match";

/** Reading a Word file can take a moment. */
export const maxDuration = 60;

/**
 * „Verbesserung → Texte hochladen“: the table „Hochgeladene Texte“. Every read runs the name
 * matching again (pure, no AI), so files meet a Seitenstruktur uploaded after them.
 */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  try {
    const data: ContentTextUploadsResult = await loadTextUploadsResult(gated.gate.service, gated.gate.organisationId);
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Hochgeladene Texte konnten nicht geladen werden.", 500);
  }
}

/**
 * ONE Word file per request (multipart: `organisationId`, `file`, optional `replace=1`, optional
 * `uploadId` for „Ersetzen“ on a row). The browser sends a batch as a queue, so no request comes
 * near the host's body limit, and one unreadable file never stops the others: it is answered
 * with `error` set and shows in the table. Only the extracted text is stored.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return contentError("Ungültige Anfrage (kein Formular).", 400);
  }
  const gated = await gateContentRoute(form.get("organisationId"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const file = form.get("file");
  if (!(file instanceof File)) return contentError("Bitte eine Word-Datei (.docx) auswählen.", 400);
  if (file.size > TEXT_UPLOAD_MAX_FILE_BYTES) {
    return contentError(`„${file.name}“ ist zu groß (max. ${Math.round(TEXT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024))} MB).`, 413);
  }
  const uploadId = form.get("uploadId");

  try {
    const stored = await storeTextUpload(gate.service, {
      organisationId: gate.organisationId,
      userId: gate.userId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      replace: form.get("replace") === "1",
      uploadId: typeof uploadId === "string" && uploadId ? uploadId : null,
    });
    if (!stored.ok) return contentError(stored.message, stored.status);
    const data: ContentTextUploadResult = stored.data;
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Die Datei konnte nicht gespeichert werden.", 500);
  }
}
