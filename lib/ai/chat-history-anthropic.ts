import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_CHAT_ATTACHMENTS_BUCKET,
  bufferToAnthropicBlocks,
  isMultimodalMediaType,
  isSkippedStoragePath,
  normalizeMimeType,
  Uint8ArrayToBase64Utf8Friendly,
} from "@/lib/ai/chat-attachments";

export type DbChatMessageRow = {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
};

export type DbAttachmentRow = {
  message_id: string | null;
  storage_path: string;
  mime_type: string;
  file_name: string;
};

/** Strip legacy inlined JSON attachment appendix from persisted user content */
export function stripLegacyAttachmentSuffix(content: string): string {
  const idx = content.indexOf("\n\nAnhang-Zusammenfassung:\n");
  if (idx < 0) return content;
  return content.slice(0, idx).trimEnd();
}

const MAX_HISTORICAL_MULTIMODAL_FILES = 4;

export async function hydrateHistoryForAnthropic(input: {
  supabase: SupabaseClient;
  messages: DbChatMessageRow[];
  attachmentsByMessageId: Map<string, DbAttachmentRow[]>;
}): Promise<Anthropic.MessageParam[]> {
  const out: Anthropic.MessageParam[] = [];

  for (const m of input.messages) {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      continue;
    }
    if (m.role !== "user") continue;

    const content = await buildUserMessageParamContent(
      m,
      input.supabase,
      input.attachmentsByMessageId.get(m.id) ?? [],
    );
    out.push({ role: "user", content });
  }

  return out;
}

async function buildUserMessageParamContent(
  m: DbChatMessageRow,
  supabase: SupabaseClient,
  attachRows: DbAttachmentRow[],
): Promise<string | Anthropic.ContentBlockParam[]> {
  let textBody = stripLegacyAttachmentSuffix(m.content);
  const meta =
    m.metadata && typeof m.metadata === "object" ? (m.metadata as Record<string, unknown>) : null;
  const metaAttachments = Array.isArray(meta?.attachments)
    ? (meta.attachments as Array<{ fileName?: unknown; textPreview?: unknown }>)
    : [];

  const excerpts = metaAttachments
    .filter((a) => typeof a?.textPreview === "string" && String(a.textPreview).trim().length > 0)
    .map(
      (a) =>
        `\n\n--- ${typeof a.fileName === "string" && a.fileName.trim() ? a.fileName.trim() : "Anhang"} ---\n${String(a.textPreview)}`,
    )
    .join("");
  textBody += excerpts;

  const multimodalCandidates = attachRows.filter(
    (row) => isMultimodalMediaType(row.mime_type) && !isSkippedStoragePath(row.storage_path),
  );

  if (multimodalCandidates.length === 0) {
    return textBody;
  }

  const blocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: textBody }];
  let used = 0;

  for (const row of multimodalCandidates) {
    if (used >= MAX_HISTORICAL_MULTIMODAL_FILES) break;
    const { data, error } = await supabase.storage
      .from(AI_CHAT_ATTACHMENTS_BUCKET)
      .download(row.storage_path);

    if (error || !data) {
      console.warn("ai_chat attachment download skipped", row.storage_path, error?.message);
      continue;
    }

    try {
      const buf = new Uint8Array(await data.arrayBuffer());
      if (buf.length === 0) continue;
      const b64 = Uint8ArrayToBase64Utf8Friendly(buf);
      const normMime = normalizeMimeType(row.mime_type);
      const extraBlocks = bufferToAnthropicBlocks(normMime, b64);
      blocks.push(...extraBlocks);
      used += 1;
    } catch (e) {
      console.warn("ai_chat attachment buffer failed", row.storage_path, e);
    }
  }

  if (blocks.length === 1) return textBody;
  return blocks;
}
