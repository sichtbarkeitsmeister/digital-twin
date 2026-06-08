import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  decodeBase64Strict,
  isSkippedStoragePath,
  normalizeMimeType,
  sanitizeStorageFileSegment,
  bufferToAnthropicBlocks,
  Uint8ArrayToBase64Utf8Friendly,
  isMultimodalMediaType,
} from "@/lib/ai/chat-attachments";
import {
  DT_MAX_ATTACHMENTS,
  DT_MAX_ATTACHMENT_BYTES,
  isDtMultimodalMime,
  isDtWordMime,
  MAX_ATTACHMENT_BASE64_CHARS,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";
import { extractTextPreviewFromBytes } from "@/lib/dt/parse-attachment-text";

export const DT_CHAT_ATTACHMENTS_BUCKET = "dt-chat-attachments";

export const dtAttachmentInboundSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative().max(DT_MAX_ATTACHMENT_BYTES),
    textContent: z.string().max(20_000).optional(),
    dataBase64: z.string().max(MAX_ATTACHMENT_BASE64_CHARS).optional(),
  })
  .superRefine((a, ctx) => {
    if (isDtWordMime(a.mimeType)) {
      ctx.addIssue({
        code: "custom",
        message: "Word-Dateien werden nicht unterstützt. Bitte als PDF exportieren.",
        path: ["mimeType"],
      });
      return;
    }
    const norm = normalizeDtMime(a.mimeType);
    if (isDtMultimodalMime(norm) && !a.dataBase64?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `Für „${a.fileName}“ fehlt die Datei (dataBase64).`,
        path: ["dataBase64"],
      });
    }
  });

export type DtInboundAttachment = z.infer<typeof dtAttachmentInboundSchema>;

export function dtAttachmentStoragePath(params: {
  organisationId: string;
  chatId: string;
  messageId: string;
  safeFileName: string;
  uniqueSuffix: string;
}): string {
  return `org_${params.organisationId}/chat_${params.chatId}/msg_${params.messageId}/${params.uniqueSuffix}_${params.safeFileName}`;
}

export async function persistDtChatAttachments(params: {
  supabase: SupabaseClient;
  organisationId: string;
  chatId: string;
  messageId: string;
  attachments: DtInboundAttachment[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const uploadedPaths: string[] = [];

  try {
    for (let i = 0; i < params.attachments.length; i += 1) {
      const a = params.attachments[i]!;
      const norm = normalizeDtMime(a.mimeType);
      const safeName = sanitizeStorageFileSegment(a.fileName);
      const unique = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;

      if (isDtMultimodalMime(norm) && a.dataBase64?.trim()) {
        const bytes = decodeBase64Strict(a.dataBase64.trim());
        const path = dtAttachmentStoragePath({
          organisationId: params.organisationId,
          chatId: params.chatId,
          messageId: params.messageId,
          safeFileName: safeName,
          uniqueSuffix: unique,
        });
        const { error: upErr } = await params.supabase.storage
          .from(DT_CHAT_ATTACHMENTS_BUCKET)
          .upload(path, bytes, { contentType: norm, upsert: false });
        if (upErr) {
          await cleanupUploaded(params.supabase, uploadedPaths);
          return { ok: false, message: upErr.message };
        }
        uploadedPaths.push(path);
        const { error: insErr } = await params.supabase.from("dt_chat_attachments").insert({
          chat_id: params.chatId,
          message_id: params.messageId,
          storage_path: path,
          file_name: a.fileName,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        });
        if (insErr) {
          await cleanupUploaded(params.supabase, uploadedPaths);
          return { ok: false, message: insErr.message };
        }
      } else if (a.textContent?.trim()) {
        const path = `meta-only/${params.messageId}/${unique}_${safeName}`;
        const { error: insErr } = await params.supabase.from("dt_chat_attachments").insert({
          chat_id: params.chatId,
          message_id: params.messageId,
          storage_path: path,
          file_name: a.fileName,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        });
        if (insErr) {
          return { ok: false, message: insErr.message };
        }
      }
    }
    return { ok: true };
  } catch (e) {
    await cleanupUploaded(params.supabase, uploadedPaths);
    return { ok: false, message: e instanceof Error ? e.message : "Anhang konnte nicht gespeichert werden." };
  }
}

async function cleanupUploaded(supabase: SupabaseClient, paths: string[]) {
  if (paths.length === 0) return;
  const rm = await supabase.storage.from(DT_CHAT_ATTACHMENTS_BUCKET).remove(paths);
  if (rm.error) console.warn("[dt] attachment cleanup", rm.error.message);
}

export function buildAttachmentMetadataForMessage(attachments: DtInboundAttachment[]) {
  return attachments.map((a) => ({
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    ...(a.textContent?.trim() ? { textPreview: a.textContent.trim().slice(0, 20_000) } : {}),
  }));
}

export async function prepareInboundAttachments(
  attachments: DtInboundAttachment[],
): Promise<{ ok: true; items: DtInboundAttachment[] } | { ok: false; message: string }> {
  if (attachments.length > DT_MAX_ATTACHMENTS) {
    return { ok: false, message: `Höchstens ${DT_MAX_ATTACHMENTS} Anhänge pro Nachricht.` };
  }

  const items: DtInboundAttachment[] = [];
  for (const a of attachments) {
    const norm = normalizeDtMime(a.mimeType);
    if (isDtWordMime(norm)) {
      return { ok: false, message: "Word-Dateien werden nicht unterstützt. Bitte als PDF exportieren." };
    }

    if (a.textContent?.trim() || isDtMultimodalMime(norm)) {
      items.push(a);
      continue;
    }

    if (a.dataBase64?.trim() && !isDtMultimodalMime(norm)) {
      try {
        const bytes = decodeBase64Strict(a.dataBase64.trim());
        const extracted = extractTextPreviewFromBytes(a.fileName, a.mimeType, bytes);
        if (!extracted.ok) return extracted;
        items.push({ ...a, textContent: extracted.text, dataBase64: undefined });
      } catch {
        return { ok: false, message: `„${a.fileName}“ konnte nicht gelesen werden.` };
      }
      continue;
    }

    items.push(a);
  }

  return { ok: true, items };
}

export { isSkippedStoragePath, normalizeMimeType as normalizeDtAttachmentMime, isMultimodalMediaType };
export { bufferToAnthropicBlocks, Uint8ArrayToBase64Utf8Friendly };
