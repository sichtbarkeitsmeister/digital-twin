import "server-only";

import { randomUUID } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";
import {
  FIRST_CONVERSATION_MAX_FILE_BYTES,
  FIRST_CONVERSATION_MAX_FILES,
  type FirstConversationFileMeta,
} from "@/lib/surveys/first-conversation";
import { extractMeetingDocumentTextAsync } from "@/lib/surveys/extract-meeting-document-text";
import { sanitizeStorageFileSegment } from "@/lib/ai/chat-attachments";

export const FIRST_CONVERSATION_FILES_BUCKET = "dt-first-conversation-files";

export type FirstConversationFileRow = FirstConversationFileMeta & {
  extractedText: string;
};

function toMeta(row: {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extracted_text: string | null;
  created_at: string;
}): FirstConversationFileMeta {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    hasText: Boolean(row.extracted_text?.trim()),
    createdAt: row.created_at,
  };
}

export async function listFirstConversationFiles(
  organisationId: string,
): Promise<FirstConversationFileMeta[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_org_first_conversation_files")
    .select("id,file_name,mime_type,size_bytes,extracted_text,created_at")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toMeta);
}

export async function loadFirstConversationDocumentText(
  organisationId: string,
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_org_first_conversation_files")
    .select("file_name,extracted_text")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true });
  const parts: string[] = [];
  for (const row of data ?? []) {
    const text = row.extracted_text?.trim();
    if (!text) continue;
    parts.push(`### Datei: ${row.file_name}\n${text}`);
  }
  return parts.join("\n\n").slice(0, 40_000);
}

export async function uploadFirstConversationFile(input: {
  organisationId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<
  | { ok: true; file: FirstConversationFileMeta; extractedText: string; extractWarning: string | null }
  | { ok: false; message: string }
> {
  if (input.bytes.byteLength === 0) {
    return { ok: false, message: "Die Datei ist leer." };
  }
  if (input.bytes.byteLength > FIRST_CONVERSATION_MAX_FILE_BYTES) {
    return { ok: false, message: "Datei ist größer als 10 MB." };
  }

  const supabase = createServiceClient();
  const { count } = await supabase
    .from("dt_org_first_conversation_files")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", input.organisationId);
  if ((count ?? 0) >= FIRST_CONVERSATION_MAX_FILES) {
    return { ok: false, message: `Maximal ${FIRST_CONVERSATION_MAX_FILES} Dateien.` };
  }

  const extracted = await extractMeetingDocumentTextAsync({
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });
  const extractedText = extracted.ok ? extracted.text : "";
  const extractWarning = extracted.ok ? null : extracted.message;

  const fileId = randomUUID();
  const safeName = sanitizeStorageFileSegment(input.fileName);
  const storagePath = `org_${input.organisationId}/${fileId}/${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(FIRST_CONVERSATION_FILES_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return { ok: false, message: upErr.message || "Upload in den Speicher fehlgeschlagen." };
  }

  const { data, error } = await supabase
    .from("dt_org_first_conversation_files")
    .insert({
      id: fileId,
      organisation_id: input.organisationId,
      storage_path: storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType || "application/octet-stream",
      size_bytes: input.bytes.byteLength,
      extracted_text: extractedText || null,
      created_by_user_id: input.userId,
    })
    .select("id,file_name,mime_type,size_bytes,extracted_text,created_at")
    .single();

  if (error || !data) {
    await supabase.storage.from(FIRST_CONVERSATION_FILES_BUCKET).remove([storagePath]);
    return { ok: false, message: error?.message || "Datei konnte nicht gespeichert werden." };
  }

  return {
    ok: true,
    file: toMeta(data),
    extractedText,
    extractWarning,
  };
}

export async function deleteFirstConversationFile(input: {
  organisationId: string;
  fileId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dt_org_first_conversation_files")
    .select("id,storage_path")
    .eq("id", input.fileId)
    .eq("organisation_id", input.organisationId)
    .maybeSingle();
  if (!data) return { ok: false, message: "Datei nicht gefunden." };

  await supabase.storage.from(FIRST_CONVERSATION_FILES_BUCKET).remove([data.storage_path]);
  const { error } = await supabase
    .from("dt_org_first_conversation_files")
    .delete()
    .eq("id", input.fileId)
    .eq("organisation_id", input.organisationId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
