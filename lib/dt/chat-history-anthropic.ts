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
import { isDtMultimodalMime, resolveDtStorageMime } from "@/lib/dt/attachments-shared";
import {
  extractTextPreviewFromBytes,
  isDtPlaceholderAttachmentText,
} from "@/lib/dt/parse-attachment-text";
import { formatAttachedFilesForPrompt } from "@/lib/dt/format-attached-files-for-prompt";
import { createServiceClient } from "@/lib/supabase/service";

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
  const meta =
    m.metadata && typeof m.metadata === "object" ? (m.metadata as Record<string, unknown>) : null;
  const metaAttachments = Array.isArray(meta?.attachments)
    ? (meta.attachments as Array<{
        fileName?: unknown;
        mimeType?: unknown;
        textPreview?: unknown;
      }>)
    : [];

  const filesForPrompt: Array<{ fileName: string; text?: string | null }> = [];
  const seen = new Set<string>();

  const addFile = (fileName: string, text?: string | null) => {
    const key = fileName.trim().toLowerCase() || `anon-${seen.size}`;
    if (seen.has(key)) {
      const existing = filesForPrompt.find((f) => f.fileName.trim().toLowerCase() === key);
      if (
        existing &&
        text?.trim() &&
        (isDtPlaceholderAttachmentText(existing.text) || !existing.text?.trim())
      ) {
        existing.text = text;
      }
      return;
    }
    seen.add(key);
    filesForPrompt.push({ fileName: fileName.trim() || "Anhang", text });
  };

  for (const a of metaAttachments) {
    const name =
      typeof a.fileName === "string" && a.fileName.trim() ? a.fileName.trim() : "Anhang";
    const preview =
      typeof a.textPreview === "string" && a.textPreview.trim() ? a.textPreview.trim() : null;
    addFile(name, preview);
  }

  const multimodalBlocks: Anthropic.ContentBlockParam[] = [];
  let used = 0;

  for (const row of attachRows) {
    addFile(row.file_name);
    if (isSkippedStoragePath(row.storage_path)) continue;

    const buf = await downloadDtAttachmentBytes(supabase, row.storage_path);
    if (!buf) {
      console.warn("[dt] attachment download skipped", row.storage_path);
      continue;
    }
    try {
      const mime = resolveDtStorageMime(row.file_name, row.mime_type, buf);
      const existing = filesForPrompt.find(
        (f) => f.fileName.trim().toLowerCase() === row.file_name.trim().toLowerCase(),
      );
      if (isDtPlaceholderAttachmentText(existing?.text)) {
        const extracted = await extractTextPreviewFromBytes(row.file_name, mime, buf);
        addFile(row.file_name, extracted.ok ? extracted.text : extracted.message);
      }
      if (used >= MAX_HISTORICAL_MULTIMODAL) continue;
      if (isDtMultimodalMime(mime) || isMultimodalMediaType(mime)) {
        const b64 = Uint8ArrayToBase64Utf8Friendly(buf);
        const blocks = bufferToAnthropicBlocks(normalizeDtAttachmentMime(mime), b64);
        if (blocks.length > 0) {
          multimodalBlocks.push(...blocks);
          used += 1;
        }
      }
    } catch (e) {
      console.warn("[dt] attachment buffer failed", row.storage_path, e);
    }
  }

  const attachmentText = formatAttachedFilesForPrompt(filesForPrompt);
  const textBody = attachmentText ? `${m.content}\n\n${attachmentText}` : m.content;

  if (multimodalBlocks.length === 0) return textBody;
  return [{ type: "text", text: textBody }, ...multimodalBlocks];
}

async function downloadDtAttachmentBytes(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<Uint8Array | null> {
  const tryClient = async (client: SupabaseClient) => {
    const { data, error } = await client.storage
      .from(DT_CHAT_ATTACHMENTS_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    return buf.byteLength > 0 ? buf : null;
  };

  try {
    const fromService = await tryClient(createServiceClient());
    if (fromService) return fromService;
  } catch (e) {
    console.warn(
      "[dt] attachment service download unavailable",
      storagePath,
      e instanceof Error ? e.message : e,
    );
  }
  return tryClient(supabase);
}
