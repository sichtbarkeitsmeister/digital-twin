import { createClient } from "@/lib/supabase/client";

import {
  DT_CHAT_ATTACHMENTS_BUCKET,
  DT_MAX_INLINE_ATTACHMENT_BYTES,
  isDtSpreadsheetFile,
  isDtTextLikeMime,
  resolveDtStorageMime,
} from "@/lib/dt/attachments-shared";
import type { DtAttachmentDraft } from "@/lib/dt/client-attachments";
import {
  indexesExceedingChatRequestBudget,
  type DtOutboundAttachment,
} from "@/lib/dt/chat-attachment-payload";

const TEXT_PREVIEW_MAX = 40_000;

type WorkingAttachment = DtOutboundAttachment & {
  sourceFile?: File;
};

async function textPreviewFromFile(file: File, fileName: string, mimeType: string): Promise<string> {
  if (isDtSpreadsheetFile(fileName, mimeType)) {
    const { extractExcelText } = await import("@/lib/dt/excel-text");
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      return extractExcelText(bytes).slice(0, TEXT_PREVIEW_MAX);
    } catch {
      return `[Excel-Datei „${fileName}“ konnte nicht gelesen werden, ist aber angehängt.]`;
    }
  }
  if (isDtTextLikeMime(mimeType, fileName)) {
    const text = (await file.text()).slice(0, TEXT_PREVIEW_MAX);
    return text.trim() || `[Textdatei „${fileName}“ ist angehängt, der Inhalt war leer.]`;
  }
  return "";
}

export async function uploadDtChatAttachment(params: {
  organisationId: string;
  chatId: string;
  file: File;
  fileName: string;
  mimeType: string;
}): Promise<{ ok: true; storagePath: string } | { ok: false; message: string }> {
  const safe = params.fileName.replace(/[/\\?\u0000-\u001f]/g, "_").slice(0, 180) || "datei";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = `org_${params.organisationId}/chat_${params.chatId}/inbox/${unique}_${safe}`;
  const contentType = resolveDtStorageMime(params.fileName, params.mimeType);
  const supabase = createClient();
  const { error } = await supabase.storage.from(DT_CHAT_ATTACHMENTS_BUCKET).upload(storagePath, params.file, {
    contentType,
    upsert: false,
  });
  if (error) {
    return {
      ok: false,
      message: `„${params.fileName}“ konnte nicht hochgeladen werden. ${error.message}`,
    };
  }
  return { ok: true, storagePath };
}

function toOutbound(attachment: WorkingAttachment): DtOutboundAttachment {
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.textContent?.trim() ? { textContent: attachment.textContent } : {}),
    ...(attachment.dataBase64?.trim() ? { dataBase64: attachment.dataBase64 } : {}),
    ...(attachment.storagePath?.trim() ? { storagePath: attachment.storagePath } : {}),
  };
}

/**
 * Keep the chat POST under the platform body limit.
 * Large files go to storage (saved chats) or become extracted text (Ghost).
 */
export async function materializeDtOutgoingAttachments(input: {
  drafts: DtAttachmentDraft[];
  content: string;
  ghostMode: boolean;
  organisationId: string | null;
  chatId: string | null;
}): Promise<{ ok: true; attachments: DtOutboundAttachment[] } | { ok: false; message: string }> {
  const working: WorkingAttachment[] = input.drafts.map((draft) => ({
    fileName: draft.fileName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    textContent: draft.textContent,
    dataBase64: draft.dataBase64,
    sourceFile: draft.sourceFile,
  }));

  const externalize = async (attachment: WorkingAttachment): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (attachment.storagePath) {
      attachment.dataBase64 = undefined;
      return { ok: true };
    }
    if (!input.ghostMode && attachment.sourceFile && input.organisationId && input.chatId) {
      const uploaded = await uploadDtChatAttachment({
        organisationId: input.organisationId,
        chatId: input.chatId,
        file: attachment.sourceFile,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      });
      if (!uploaded.ok) return uploaded;
      attachment.storagePath = uploaded.storagePath;
      attachment.dataBase64 = undefined;
      return { ok: true };
    }
    if (attachment.sourceFile) {
      const preview = await textPreviewFromFile(
        attachment.sourceFile,
        attachment.fileName,
        attachment.mimeType,
      );
      if (!preview.trim() && !attachment.textContent?.trim()) {
        return {
          ok: false,
          message: input.ghostMode
            ? `„${attachment.fileName}“ ist zu groß für den Ghost-Modus. Bitte Ghost ausschalten.`
            : `„${attachment.fileName}“ konnte nicht hochgeladen werden.`,
        };
      }
      attachment.textContent = preview || attachment.textContent;
      attachment.dataBase64 = undefined;
      return { ok: true };
    }
    if (attachment.textContent?.trim()) {
      attachment.dataBase64 = undefined;
      return { ok: true };
    }
    return {
      ok: false,
      message: `„${attachment.fileName}“ ist zu groß für den direkten Upload.`,
    };
  };

  for (const attachment of working) {
    const tooBigToInline =
      !attachment.dataBase64?.trim() ||
      attachment.sizeBytes > DT_MAX_INLINE_ATTACHMENT_BYTES ||
      (attachment.dataBase64?.length ?? 0) > Math.ceil((DT_MAX_INLINE_ATTACHMENT_BYTES * 4) / 3);
    if (!tooBigToInline) continue;
    const moved = await externalize(attachment);
    if (!moved.ok) return moved;
  }

  const overflow = indexesExceedingChatRequestBudget(input.content, working);
  for (const index of overflow) {
    const attachment = working[index];
    if (!attachment?.dataBase64) continue;
    const moved = await externalize(attachment);
    if (!moved.ok) return moved;
  }

  const stillOver = indexesExceedingChatRequestBudget(input.content, working);
  if (stillOver.length > 0) {
    return {
      ok: false,
      message: "Die Anhänge sind zusammen zu groß. Bitte weniger oder kleinere Dateien senden.",
    };
  }

  return { ok: true, attachments: working.map(toOutbound) };
}
