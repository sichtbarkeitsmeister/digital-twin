import {
  DT_MAX_ATTACHMENT_BYTES,
  guessDtMimeFromName,
  isDtGenericUploadMime,
  isDtMultimodalImageMime,
  isDtMultimodalMime,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";

export type DtAttachmentDraft = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  dataBase64?: string;
  previewObjectUrl?: string;
};

export function guessDtMimeFromFile(file: File): string {
  const fromType = file.type?.trim() ?? "";
  if (fromType && !isDtGenericUploadMime(fromType)) return fromType;
  return guessDtMimeFromName(file.name, fromType || "application/octet-stream");
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export async function fileToDtAttachmentDraft(
  file: File,
): Promise<{ ok: true; draft: DtAttachmentDraft } | { ok: false; message: string }> {
  const rawMime = guessDtMimeFromFile(file);
  const norm = normalizeDtMime(rawMime);

  if (file.size <= 0) {
    return { ok: false, message: `„${file.name}“ ist leer.` };
  }
  if (file.size > DT_MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `„${file.name}“ ist zu groß (max. ${Math.round(DT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`,
    };
  }

  const draft: DtAttachmentDraft = {
    fileName: file.name,
    mimeType: rawMime || norm || "application/octet-stream",
    sizeBytes: file.size,
  };

  try {
    draft.dataBase64 = await readFileAsBase64(file);
    if (isDtMultimodalImageMime(norm) || isDtMultimodalImageMime(draft.mimeType)) {
      draft.previewObjectUrl = URL.createObjectURL(file);
    }
  } catch {
    return { ok: false, message: `„${file.name}“ konnte nicht gelesen werden.` };
  }

  if (!isDtMultimodalMime(norm) && !isDtMultimodalMime(draft.mimeType)) {
    try {
      const asText = await file.text();
      const probe = asText.slice(0, 1024);
      const looksBinary =
        asText.startsWith("PK") ||
        /[\u0000-\u0008]/.test(probe) ||
        asText.includes("\u0000");
      if (asText && !looksBinary) {
        draft.textContent = asText.slice(0, 20_000);
      }
    } catch {
      // binary — server extracts Excel/Word/etc. from dataBase64
    }
  }

  return { ok: true, draft };
}

export function revokeDtDraftPreview(draft: DtAttachmentDraft) {
  if (draft.previewObjectUrl) URL.revokeObjectURL(draft.previewObjectUrl);
}

export type DtStoredAttachment = {
  id?: string;
  message_id?: string | null;
  file_name: string;
  mime_type: string;
  size_bytes?: number;
  signed_url?: string | null;
  source?: "upload" | "created";
};
