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
  DT_CHAT_ATTACHMENTS_BUCKET,
  DT_MAX_ATTACHMENTS,
  DT_MAX_ATTACHMENT_BYTES,
  isDtChatOwnedStoragePath,
  isDtTextLikeMime,
  MAX_ATTACHMENT_BASE64_CHARS,
  normalizeDtMime,
  resolveDtStorageMime,
} from "@/lib/dt/attachments-shared";
import type { DtCreatedChatFile } from "@/lib/dt/chat-files";
import { extractTextPreviewFromBytes, DT_ATTACHMENT_TEXT_PREVIEW_MAX } from "@/lib/dt/parse-attachment-text";
import { ensureDtChatAttachmentsAcceptAllMimes } from "@/lib/dt/ensure-chat-attachments-bucket";

export { DT_CHAT_ATTACHMENTS_BUCKET };

export const dtAttachmentInboundSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative().max(DT_MAX_ATTACHMENT_BYTES),
    textContent: z.string().max(40_000).optional(),
    dataBase64: z.string().max(MAX_ATTACHMENT_BASE64_CHARS).optional(),
    /** Set when the browser uploaded the bytes to storage before the chat POST. */
    storagePath: z.string().min(1).max(500).optional(),
  })
  .superRefine((a, ctx) => {
    if (!a.dataBase64?.trim() && !a.textContent?.trim() && !a.storagePath?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: `Für „${a.fileName}“ fehlt die Datei.`,
        path: ["dataBase64"],
      });
    }
  });

export type DtInboundAttachment = z.infer<typeof dtAttachmentInboundSchema>;

export type DtChatAttachmentRow = {
  id: string;
  chat_id: string;
  message_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  signed_url?: string | null;
  source?: "upload" | "created";
};

export function dtAttachmentStoragePath(params: {
  organisationId: string;
  chatId: string;
  messageId: string;
  safeFileName: string;
  uniqueSuffix: string;
}): string {
  return `org_${params.organisationId}/chat_${params.chatId}/msg_${params.messageId}/${params.uniqueSuffix}_${params.safeFileName}`;
}

export type DtPersistableChatFile = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

function isMimeBlockedMessage(message: string): boolean {
  return /mime|not allowed|invalid|unsupported|not supported/i.test(message);
}

async function tryUpload(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await supabase.storage
    .from(DT_CHAT_ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (!result.error) return { ok: true };
  return { ok: false, message: result.error.message };
}

async function uploadChatFileBytes(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<{ ok: true; mimeType: string } | { ok: false; message: string; mimeBlocked: boolean }> {
  const preferred = resolveDtStorageMime(fileName, mimeType, bytes);
  const fallbacks = isDtTextLikeMime(preferred, fileName) ? ["text/plain", "text/csv"] : [];
  const candidates = Array.from(
    new Set([preferred, mimeType, ...fallbacks].map((m) => normalizeDtMime(m)).filter(Boolean)),
  );

  await ensureDtChatAttachmentsAcceptAllMimes();

  let lastMessage = "Datei konnte nicht gespeichert werden.";
  for (const contentType of candidates) {
    const uploaded = await tryUpload(supabase, path, bytes, contentType);
    if (uploaded.ok) return { ok: true, mimeType: contentType };
    lastMessage = uploaded.message;
    if (!isMimeBlockedMessage(uploaded.message)) {
      return { ok: false, message: lastMessage, mimeBlocked: false };
    }
  }

  // Bucket may have just been opened; retry the preferred type once more.
  const retry = await tryUpload(supabase, path, bytes, preferred);
  if (retry.ok) return { ok: true, mimeType: preferred };
  lastMessage = retry.message;

  return {
    ok: false,
    message: lastMessage,
    mimeBlocked: isMimeBlockedMessage(lastMessage),
  };
}

export async function persistDtChatFileBlobs(params: {
  supabase: SupabaseClient;
  organisationId: string;
  chatId: string;
  messageId: string;
  files: DtPersistableChatFile[];
}): Promise<{ ok: true; rows: DtChatAttachmentRow[] } | { ok: false; message: string }> {
  const uploadedPaths: string[] = [];
  const rows: DtChatAttachmentRow[] = [];

  try {
    for (let i = 0; i < params.files.length; i += 1) {
      const file = params.files[i]!;
      const safeName = sanitizeStorageFileSegment(file.fileName);
      const unique = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;
      const path = dtAttachmentStoragePath({
        organisationId: params.organisationId,
        chatId: params.chatId,
        messageId: params.messageId,
        safeFileName: safeName,
        uniqueSuffix: unique,
      });
      const uploaded = await uploadChatFileBytes(
        params.supabase,
        path,
        file.bytes,
        file.mimeType,
        file.fileName,
      );
      if (!uploaded.ok) {
        if (uploaded.mimeBlocked) {
          const uniqueMeta = `${Date.now()}-meta-${i}`;
          const metaPath = `meta-only/${params.messageId}/${uniqueMeta}_${safeName}`;
          const { data, error: insErr } = await params.supabase
            .from("dt_chat_attachments")
            .insert({
              chat_id: params.chatId,
              message_id: params.messageId,
              storage_path: metaPath,
              file_name: file.fileName,
              mime_type: resolveDtStorageMime(file.fileName, file.mimeType, file.bytes),
              size_bytes: file.bytes.byteLength,
            })
            .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
            .single();
          if (insErr || !data) {
            await cleanupUploaded(params.supabase, uploadedPaths);
            return { ok: false, message: insErr?.message ?? uploaded.message };
          }
          rows.push(data as DtChatAttachmentRow);
          continue;
        }
        await cleanupUploaded(params.supabase, uploadedPaths);
        return uploaded;
      }
      uploadedPaths.push(path);
      const { data, error: insErr } = await params.supabase
        .from("dt_chat_attachments")
        .insert({
          chat_id: params.chatId,
          message_id: params.messageId,
          storage_path: path,
          file_name: file.fileName,
          mime_type: uploaded.mimeType,
          size_bytes: file.bytes.byteLength,
        })
        .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
        .single();
      if (insErr || !data) {
        await cleanupUploaded(params.supabase, uploadedPaths);
        return { ok: false, message: insErr?.message ?? "Anhang konnte nicht gespeichert werden." };
      }
      rows.push(data as DtChatAttachmentRow);
    }
    return { ok: true, rows };
  } catch (e) {
    await cleanupUploaded(params.supabase, uploadedPaths);
    return { ok: false, message: e instanceof Error ? e.message : "Anhang konnte nicht gespeichert werden." };
  }
}

export async function persistDtChatAttachments(params: {
  supabase: SupabaseClient;
  organisationId: string;
  chatId: string;
  messageId: string;
  attachments: DtInboundAttachment[];
}): Promise<{ ok: true; rows: DtChatAttachmentRow[] } | { ok: false; message: string }> {
  const blobs: DtPersistableChatFile[] = [];
  const metaOnly: DtInboundAttachment[] = [];

  const alreadyStored: DtInboundAttachment[] = [];

  for (const a of params.attachments) {
    if (a.storagePath?.trim() && !a.dataBase64?.trim()) {
      if (
        !isDtChatOwnedStoragePath(a.storagePath, params.organisationId, params.chatId)
      ) {
        return { ok: false, message: `„${a.fileName}“ liegt außerhalb dieses Chats.` };
      }
      alreadyStored.push(a);
      continue;
    }
    if (a.dataBase64?.trim()) {
      try {
        const bytes = decodeBase64Strict(a.dataBase64.trim());
        blobs.push({
          fileName: a.fileName,
          mimeType: resolveDtStorageMime(a.fileName, a.mimeType, bytes),
          bytes,
        });
      } catch {
        return { ok: false, message: `„${a.fileName}“ konnte nicht gelesen werden.` };
      }
    } else if (a.textContent?.trim()) {
      metaOnly.push(a);
    }
  }

  const persisted = blobs.length
    ? await persistDtChatFileBlobs({
        supabase: params.supabase,
        organisationId: params.organisationId,
        chatId: params.chatId,
        messageId: params.messageId,
        files: blobs,
      })
    : { ok: true as const, rows: [] as DtChatAttachmentRow[] };
  if (!persisted.ok) return persisted;

  const rows = [...persisted.rows];
  for (const a of alreadyStored) {
    const storagePath = a.storagePath?.trim() ?? "";
    if (!storagePath) continue;
    const { data, error: insErr } = await params.supabase
      .from("dt_chat_attachments")
      .insert({
        chat_id: params.chatId,
        message_id: params.messageId,
        storage_path: storagePath,
        file_name: a.fileName,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes,
      })
      .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
      .single();
    if (insErr || !data) {
      return { ok: false, message: insErr?.message ?? "Anhang konnte nicht gespeichert werden." };
    }
    rows.push(data as DtChatAttachmentRow);
  }
  for (let i = 0; i < metaOnly.length; i += 1) {
    const a = metaOnly[i]!;
    const unique = `${Date.now()}-meta-${i}`;
    const path = `meta-only/${params.messageId}/${unique}_${sanitizeStorageFileSegment(a.fileName)}`;
    const { data, error: insErr } = await params.supabase
      .from("dt_chat_attachments")
      .insert({
        chat_id: params.chatId,
        message_id: params.messageId,
        storage_path: path,
        file_name: a.fileName,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes,
      })
      .select("id,chat_id,message_id,storage_path,file_name,mime_type,size_bytes,created_at")
      .single();
    if (insErr || !data) {
      return { ok: false, message: insErr?.message ?? "Anhang konnte nicht gespeichert werden." };
    }
    rows.push(data as DtChatAttachmentRow);
  }

  return { ok: true, rows };
}

export async function persistCreatedChatFiles(params: {
  supabase: SupabaseClient;
  organisationId: string;
  chatId: string;
  messageId: string;
  files: DtCreatedChatFile[];
}): Promise<{ ok: true; rows: DtChatAttachmentRow[] } | { ok: false; message: string }> {
  if (params.files.length === 0) return { ok: true, rows: [] };
  return persistDtChatFileBlobs({
    supabase: params.supabase,
    organisationId: params.organisationId,
    chatId: params.chatId,
    messageId: params.messageId,
    files: params.files.map((f) => ({
      fileName: f.fileName,
      mimeType: f.mimeType,
      bytes: f.bytes,
    })),
  });
}

export async function signDtChatAttachmentRows(
  supabase: SupabaseClient,
  rows: Array<{
    id?: string;
    chat_id?: string;
    message_id?: string | null;
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes?: number;
    created_at?: string;
  }>,
  source?: "upload" | "created",
): Promise<DtChatAttachmentRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const base = {
        id: row.id ?? "",
        chat_id: row.chat_id ?? "",
        message_id: row.message_id ?? null,
        storage_path: row.storage_path,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes ?? 0,
        created_at: row.created_at ?? new Date().toISOString(),
        signed_url: null as string | null,
        source,
      };
      if (isSkippedStoragePath(row.storage_path)) return base;
      const { data, error } = await supabase.storage
        .from(DT_CHAT_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      if (error) {
        console.warn("[dt] attachment signed url:", row.storage_path, error.message);
        return base;
      }
      return { ...base, signed_url: data.signedUrl };
    }),
  );
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
    ...(a.textContent?.trim() ? { textPreview: a.textContent.trim().slice(0, DT_ATTACHMENT_TEXT_PREVIEW_MAX) } : {}),
  }));
}

export function buildCreatedFileMetadata(files: DtCreatedChatFile[]) {
  return files.map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.bytes.byteLength,
    title: f.title ?? f.fileName,
  }));
}

async function downloadStoredChatAttachment(
  supabase: SupabaseClient,
  path: string,
): Promise<Uint8Array | null> {
  try {
    const { data, error } = await supabase.storage.from(DT_CHAT_ATTACHMENTS_BUCKET).download(path);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    return buf.byteLength > 0 ? buf : null;
  } catch {
    return null;
  }
}

export async function prepareInboundAttachments(
  attachments: DtInboundAttachment[],
  scope?: { supabase: SupabaseClient; organisationId: string; chatId: string },
): Promise<{ ok: true; items: DtInboundAttachment[] } | { ok: false; message: string }> {
  if (attachments.length > DT_MAX_ATTACHMENTS) {
    return { ok: false, message: `Höchstens ${DT_MAX_ATTACHMENTS} Anhänge pro Nachricht.` };
  }

  const items: DtInboundAttachment[] = [];
  for (const a of attachments) {
    if (a.storagePath?.trim()) {
      if (!scope) {
        return { ok: false, message: `„${a.fileName}“ konnte nicht zugeordnet werden.` };
      }
      const storagePath = a.storagePath.trim();
      if (!isDtChatOwnedStoragePath(storagePath, scope.organisationId, scope.chatId)) {
        return { ok: false, message: `„${a.fileName}“ liegt außerhalb dieses Chats.` };
      }
      const bytes = await downloadStoredChatAttachment(scope.supabase, storagePath);
      if (!bytes) {
        if (!a.dataBase64?.trim()) {
          return { ok: false, message: `„${a.fileName}“ konnte nicht gelesen werden.` };
        }
      } else if (bytes.byteLength > DT_MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          message: `„${a.fileName}“ ist zu groß (max. ${Math.round(DT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`,
        };
      } else {
        const mimeType = resolveDtStorageMime(a.fileName, a.mimeType, bytes);
        const extracted = await extractTextPreviewFromBytes(a.fileName, mimeType, bytes);
        const text = extracted.ok ? extracted.text : extracted.message;
        items.push({
          ...a,
          storagePath,
          mimeType,
          sizeBytes: bytes.byteLength,
          dataBase64: undefined,
          textContent: text?.trim()
            ? text
            : a.textContent?.trim() || `[Datei „${a.fileName}“ ist angehängt.]`,
        });
        continue;
      }
    }

    if (a.dataBase64?.trim()) {
      try {
        const bytes = decodeBase64Strict(a.dataBase64.trim());
        const mimeType = resolveDtStorageMime(a.fileName, a.mimeType, bytes);
        const extracted = await extractTextPreviewFromBytes(a.fileName, mimeType, bytes);
        const text = extracted.ok ? extracted.text : extracted.message;
        items.push({
          ...a,
          mimeType,
          textContent: text?.trim()
            ? text
            : a.textContent?.trim() || `[Datei „${a.fileName}“ ist angehängt.]`,
          dataBase64: a.dataBase64,
        });
      } catch {
        return { ok: false, message: `„${a.fileName}“ konnte nicht gelesen werden.` };
      }
      continue;
    }

    items.push(a);
  }

  return { ok: true, items };
}

export function createdFilesToGhostMetadata(files: DtCreatedChatFile[]) {
  return files.map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.bytes.byteLength,
    dataBase64: Buffer.from(f.bytes).toString("base64"),
  }));
}

export { isSkippedStoragePath, normalizeMimeType as normalizeDtAttachmentMime, isMultimodalMediaType };
export { bufferToAnthropicBlocks, Uint8ArrayToBase64Utf8Friendly };
