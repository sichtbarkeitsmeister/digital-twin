import type Anthropic from "@anthropic-ai/sdk";

import {
  isSurveyAiMultimodalImageMime,
  isSurveyAiMultimodalPdfMime,
  isSurveyAiMultimodalMime as isMultimodalShared,
  normalizeSurveyAiMime as normalizeMimeShared,
  SURVEY_AI_MAX_ATTACHMENT_BYTES,
  SURVEY_AI_MAX_ATTACHMENTS,
} from "@/lib/ai/survey-ai-attachments-shared";

/** Private bucket — create via migration SQL; paths: `{user_id}/{chat_id}/{message_id}/...` */
export const AI_CHAT_ATTACHMENTS_BUCKET = "ai-chat-attachments";

export { SURVEY_AI_ATTACHMENT_ACCEPT_ATTR } from "@/lib/ai/survey-ai-attachments-shared";

/** Max length of client-provided base64 string per attachment (≈10 MiB binary) */
export const MAX_ATTACHMENT_BASE64_CHARS =
  Math.ceil((SURVEY_AI_MAX_ATTACHMENT_BYTES * 4) / 3) + 512;
/** Total decoded bytes per request across all multimodal attachments */
export const MAX_MULTIMODAL_TOTAL_BYTES = 28 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = SURVEY_AI_MAX_ATTACHMENTS;

/** Placeholder paths for attachments without blob storage (legacy + text-only) */
export function isSkippedStoragePath(storagePath: string): boolean {
  return (
    storagePath.startsWith("inline/") ||
    storagePath.startsWith("meta-only/") ||
    storagePath.includes("/inline/")
  );
}

export function normalizeMimeType(mimeType: string): string {
  return normalizeMimeShared(mimeType);
}

export function isMultimodalMediaType(mediaType: string): boolean {
  return isMultimodalShared(mediaType);
}

export function sanitizeStorageFileSegment(name: string): string {
  return name.replace(/[/\\?\u0000-\u001f]/g, "_").slice(0, 200) || "file";
}

/** Decode base64 payload (Whitespace stripped); rejects when decoded empty but string non-empty. */
export function decodeBase64Strict(b64: string): Uint8Array {
  const s = b64.replace(/\s/g, "");
  if (!s) throw new Error("INVALID_BASE64");
  const buf = Buffer.from(s, "base64");
  if (buf.length === 0 && s.length > 0) throw new Error("INVALID_BASE64");
  if (buf.length > SURVEY_AI_MAX_ATTACHMENT_BYTES) {
    throw new Error("ATTACHMENT_TOO_LARGE");
  }
  return buf;
}

export function bufferToAnthropicBlocks(
  mediaTypeNorm: string,
  base64Payload: string,
): Anthropic.ContentBlockParam[] {
  if (isSurveyAiMultimodalImageMime(mediaTypeNorm)) {
    const m = normalizeMimeShared(mediaTypeNorm);
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: m as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64Payload,
        },
      },
    ];
  }
  if (isSurveyAiMultimodalPdfMime(mediaTypeNorm)) {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64Payload,
        },
      },
    ];
  }
  return [];
}

export function Uint8ArrayToBase64Utf8Friendly(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function attachmentStorageObjectPath(params: {
  userId: string;
  chatId: string;
  messageId: string;
  safeFileName: string;
  uniqueSuffix: string;
}): string {
  return `${params.userId}/${params.chatId}/${params.messageId}/${params.uniqueSuffix}_${params.safeFileName}`;
}
