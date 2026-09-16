import type Anthropic from "@anthropic-ai/sdk";

import {
  bufferToAnthropicBlocks,
  decodeBase64Strict,
  normalizeMimeType as normalizeDtAttachmentMime,
} from "@/lib/ai/chat-attachments";
import type { DtInboundAttachment } from "@/lib/dt/attachments";
import { isDtMultimodalMime, resolveDtStorageMime } from "@/lib/dt/attachments-shared";
import { formatAttachedFilesForPrompt } from "@/lib/dt/format-attached-files-for-prompt";

function inboundMultimodalBlocks(attachments: DtInboundAttachment[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const a of attachments) {
    if (!a.dataBase64?.trim()) continue;
    try {
      const bytes = decodeBase64Strict(a.dataBase64.trim());
      const mime = resolveDtStorageMime(a.fileName, a.mimeType, bytes);
      if (!isDtMultimodalMime(mime)) continue;
      const b64 = Buffer.from(bytes).toString("base64");
      blocks.push(...bufferToAnthropicBlocks(normalizeDtAttachmentMime(mime), b64));
    } catch {
      // skip invalid
    }
  }
  return blocks;
}

function messageHasMultimodalBlocks(content: Anthropic.MessageParam["content"]): boolean {
  return (
    Array.isArray(content) && content.some((block) => block.type === "document" || block.type === "image")
  );
}

/** Append multimodal blocks for the latest ghost-mode user turn (in-memory only). */
export function appendEphemeralAttachmentsToMessages(
  messages: Anthropic.MessageParam[],
  text: string,
  attachments: DtInboundAttachment[],
): Anthropic.MessageParam[] {
  if (attachments.length === 0) {
    return [...messages, { role: "user", content: text || "(Anhang)" }];
  }

  const attachmentText = formatAttachedFilesForPrompt(
    attachments.map((a) => ({ fileName: a.fileName, text: a.textContent })),
  );
  const textBody = attachmentText ? `${text}\n\n${attachmentText}` : text;

  const blocks: Anthropic.ContentBlockParam[] = [
    { type: "text", text: textBody.trim() || "(Anhang)" },
    ...inboundMultimodalBlocks(attachments),
  ];

  const content = blocks.length === 1 && blocks[0]?.type === "text" ? textBody : blocks;
  return [...messages, { role: "user", content }];
}

/**
 * Persisted chats hydrate PDFs from storage; if that download fails, still attach
 * the current turn's PDF/image bytes so Claude can read them.
 */
export function ensureLatestTurnHasMultimodalBlocks(
  messages: Anthropic.MessageParam[],
  attachments: DtInboundAttachment[],
): Anthropic.MessageParam[] {
  const extra = inboundMultimodalBlocks(attachments);
  if (extra.length === 0) return messages;
  if (messages.length === 0) {
    return [{ role: "user", content: extra }];
  }

  const lastIdx = messages.length - 1;
  const last = messages[lastIdx]!;
  if (last.role !== "user") {
    return [...messages, { role: "user", content: extra }];
  }
  if (messageHasMultimodalBlocks(last.content)) return messages;

  const textBlocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? last.content.trim()
        ? [{ type: "text", text: last.content }]
        : []
      : Array.isArray(last.content)
        ? [...last.content]
        : [];
  const next = [...messages];
  next[lastIdx] = { role: "user", content: [...textBlocks, ...extra] };
  return next;
}
