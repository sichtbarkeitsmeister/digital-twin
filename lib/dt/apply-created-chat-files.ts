import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildCreatedFileMetadata,
  persistCreatedChatFiles,
  signDtChatAttachmentRows,
  type DtChatAttachmentRow,
} from "@/lib/dt/attachments";
import type { DtCreatedChatFile } from "@/lib/dt/chat-files";

export async function applyCreatedChatFiles(params: {
  supabase: SupabaseClient;
  organisationId: string;
  chatId: string;
  messageId: string;
  files: DtCreatedChatFile[];
  metadata: Record<string, unknown>;
}): Promise<{
  metadata: Record<string, unknown>;
  attachments: DtChatAttachmentRow[];
}> {
  if (params.files.length === 0) {
    return { metadata: params.metadata, attachments: [] };
  }

  const persisted = await persistCreatedChatFiles({
    supabase: params.supabase,
    organisationId: params.organisationId,
    chatId: params.chatId,
    messageId: params.messageId,
    files: params.files,
  });
  if (!persisted.ok) {
    console.warn("[dt] persist created chat files:", persisted.message);
    return { metadata: params.metadata, attachments: [] };
  }

  const attachments = await signDtChatAttachmentRows(params.supabase, persisted.rows, "created");
  return {
    metadata: {
      ...params.metadata,
      created_files: buildCreatedFileMetadata(params.files),
    },
    attachments,
  };
}
