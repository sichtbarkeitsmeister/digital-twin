import {
  DT_MAX_ATTACHMENT_BYTES,
  DT_MAX_CHAT_MESSAGE_CHARS,
  DT_MAX_CHAT_REQUEST_CHARS,
} from "@/lib/dt/attachments-shared";

export type DtOutboundAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  textContent?: string;
  dataBase64?: string;
  storagePath?: string;
};

export type PastedListDecision =
  | { action: "send" }
  | { action: "too-long" }
  | { action: "too-big" }
  | { action: "attach" };

/** Long Excel pastes are tabular. They must not ride in the JSON message body. */
export function decidePastedList(text: string): PastedListDecision {
  if (text.length <= DT_MAX_CHAT_MESSAGE_CHARS) return { action: "send" };
  const tabular = text.includes("\t") || text.split("\n").length > 30;
  if (!tabular) return { action: "too-long" };
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > DT_MAX_ATTACHMENT_BYTES) return { action: "too-big" };
  return { action: "attach" };
}

export function pastedListMessagePreview(text: string): string {
  const preview = text.split("\n").slice(0, 4).join("\n").trim().slice(0, 400);
  return preview || "Bitte die angehängte Liste auswerten.";
}

export function chatRequestCharCount(
  content: string,
  attachments: Array<Pick<DtOutboundAttachment, "dataBase64" | "textContent" | "fileName">>,
): number {
  let total = content.length;
  for (const attachment of attachments) {
    total += attachment.fileName.length;
    total += attachment.dataBase64?.length ?? 0;
    total += attachment.textContent?.length ?? 0;
    total += 64;
  }
  return total;
}

/**
 * Indexes whose base64 must leave the JSON body, largest first,
 * until the request fits the platform limit. Stops if nothing inline remains.
 */
export function indexesExceedingChatRequestBudget(
  content: string,
  attachments: Array<Pick<DtOutboundAttachment, "dataBase64" | "textContent" | "fileName">>,
): number[] {
  const remaining = attachments.map((attachment) => ({
    dataBase64: attachment.dataBase64,
    textContent: attachment.textContent,
    fileName: attachment.fileName,
  }));
  const indexes: number[] = [];
  while (chatRequestCharCount(content, remaining) > DT_MAX_CHAT_REQUEST_CHARS) {
    let biggest = -1;
    let biggestLen = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      const len = remaining[i]?.dataBase64?.length ?? 0;
      if (len > biggestLen) {
        biggest = i;
        biggestLen = len;
      }
    }
    if (biggest < 0) break;
    indexes.push(biggest);
    const current = remaining[biggest]!;
    remaining[biggest] = { ...current, dataBase64: undefined };
  }
  return indexes;
}
