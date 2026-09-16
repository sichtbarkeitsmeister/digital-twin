import type Anthropic from "@anthropic-ai/sdk";

import {
  bufferToAnthropicBlocks,
  decodeBase64Strict,
  normalizeMimeType as normalizeDtAttachmentMime,
} from "@/lib/ai/chat-attachments";
import type { DtInboundAttachment } from "@/lib/dt/attachments";
import { isDtMultimodalMime } from "@/lib/dt/attachments-shared";
import { formatAttachedFilesForPrompt } from "@/lib/dt/format-attached-files-for-prompt";

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
  ];

  for (const a of attachments) {
    const norm = normalizeDtAttachmentMime(a.mimeType);
    if (!isDtMultimodalMime(norm) || !a.dataBase64?.trim()) continue;
    try {
      const bytes = decodeBase64Strict(a.dataBase64.trim());
      const b64 = Buffer.from(bytes).toString("base64");
      blocks.push(...bufferToAnthropicBlocks(norm, b64));
    } catch {
      // skip invalid
    }
  }

  const content = blocks.length === 1 && blocks[0]?.type === "text" ? textBody : blocks;
  return [...messages, { role: "user", content }];
}
