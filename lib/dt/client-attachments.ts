import {
  DT_MAX_ATTACHMENT_BYTES,
  DT_WORD_REJECT_MESSAGE,
  isDtMultimodalImageMime,
  isDtMultimodalMime,
  isDtWordMime,
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
  if (file.type?.trim()) return file.type.trim();
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
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

  if (isDtWordMime(norm)) {
    return { ok: false, message: DT_WORD_REJECT_MESSAGE };
  }
  if (file.size > DT_MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `„${file.name}“ ist zu groß (max. ${Math.round(DT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`,
    };
  }

  const draft: DtAttachmentDraft = {
    fileName: file.name,
    mimeType: rawMime || norm,
    sizeBytes: file.size,
  };

  if (isDtMultimodalMime(norm)) {
    try {
      draft.dataBase64 = await readFileAsBase64(file);
      if (isDtMultimodalImageMime(norm)) {
        draft.previewObjectUrl = URL.createObjectURL(file);
      }
    } catch {
      return { ok: false, message: `„${file.name}“ konnte nicht gelesen werden.` };
    }
    return { ok: true, draft };
  }

  try {
    draft.textContent = (await file.text()).slice(0, 20_000);
  } catch {
    return { ok: false, message: `„${file.name}“ konnte nicht gelesen werden.` };
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
};
