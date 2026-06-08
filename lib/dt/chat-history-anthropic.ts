import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bufferToAnthropicBlocks,
  DT_CHAT_ATTACHMENTS_BUCKET,
  isMultimodalMediaType,
  isSkippedStoragePath,
  normalizeDtAttachmentMime,
  Uint8ArrayToBase64Utf8Friendly,
} from "@/lib/dt/attachments";

export type DtDbMessageRow = {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
};

export type DtDbAttachmentRow = {
  message_id: string | null;
  storage_path: string;
  mime_type: string;
  file_name: string;
};

const MAX_HISTORICAL_MULTIMODAL = 4;

export async function hydrateDtHistoryForAnthropic(input: {
  supabase: SupabaseClient;
  messages: DtDbMessageRow[];
  attachmentsByMessageId: Map<string, DtDbAttachmentRow[]>;
}): Promise<Anthropic.MessageParam[]> {
  const out: Anthropic.MessageParam[] = [];

  for (const m of input.messages) {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      continue;
    }
    if (m.role !== "user") continue;

    const content = await buildDtUserMessageContent(
      m,
      input.supabase,
      input.attachmentsByMessageId.get(m.id) ?? [],
    );
    out.push({ role: "user", content });
  }

  return out;
}

async function buildDtUserMessageContent(
  m: DtDbMessageRow,
  supabase: SupabaseClient,
  attachRows: DtDbAttachmentRow[],
): Promise<string | Anthropic.ContentBlockParam[]> {
  let textBody = m.content;
  const meta =
    m.metadata && typeof m.metadata === "object" ? (m.metadata as Record<string, unknown>) : null;
  const metaAttachments = Array.isArray(meta?.attachments)
    ? (meta.attachments as Array<{ fileName?: unknown; textPreview?: unknown }>)
    : [];

  for (const a of metaAttachments) {
    const preview =
      typeof a.textPreview === "string" && a.textPreview.trim().length > 0
        ? a.textPreview.trim()
        : null;
    if (!preview) continue;
    const name =
      typeof a.fileName === "string" && a.fileName.trim() ? a.fileName.trim() : "Anhang";
    textBody += `\n\n--- ${name} ---\n${preview}`;
  }

  const multimodal = attachRows.filter(
    (r) => isMultimodalMediaType(r.mime_type) && !isSkippedStoragePath(r.storage_path),
  );

  if (multimodal.length === 0) return textBody;

  const blocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: textBody }];
  let used = 0;

  for (const row of multimodal) {
    if (used >= MAX_HISTORICAL_MULTIMODAL) break;
    const { data, error } = await supabase.storage
      .from(DT_CHAT_ATTACHMENTS_BUCKET)
      .download(row.storage_path);
    if (error || !data) {
      console.warn("[dt] attachment download skipped", row.storage_path, error?.message);
      continue;
    }
    try {
      const buf = new Uint8Array(await data.arrayBuffer());
      const b64 = Uint8ArrayToBase64Utf8Friendly(buf);
      const norm = normalizeDtAttachmentMime(row.mime_type);
      blocks.push(...bufferToAnthropicBlocks(norm, b64));
      used += 1;
    } catch (e) {
      console.warn("[dt] attachment buffer failed", row.storage_path, e);
    }
  }

  return blocks.length === 1 ? textBody : blocks;
}
