/** DigitalTwin chat attachment limits — safe for client + server bundles. */

export const DT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DT_MAX_ATTACHMENTS = 5;
export const DT_ATTACHMENT_ACCEPT_ATTR =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,.md,.txt,.json,.csv,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MULTIMODAL_IMAGE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function normalizeDtMime(mimeType: string): string {
  return mimeType.trim().split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isDtMultimodalMime(mimeType: string): boolean {
  const m = normalizeDtMime(mimeType);
  return MULTIMODAL_IMAGE.has(m) || m === "application/pdf";
}

export function isDtMultimodalImageMime(mimeType: string): boolean {
  return MULTIMODAL_IMAGE.has(normalizeDtMime(mimeType));
}

export function isDtWordMime(mimeType: string): boolean {
  const m = normalizeDtMime(mimeType);
  return (
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function isDtExcelMime(mimeType: string): boolean {
  const m = normalizeDtMime(mimeType);
  return (
    m === "application/vnd.ms-excel" ||
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export const DT_WORD_REJECT_MESSAGE =
  "Word-Dateien werden nicht unterstützt. Bitte als PDF exportieren und erneut hochladen.";

export const MAX_ATTACHMENT_BASE64_CHARS =
  Math.ceil((DT_MAX_ATTACHMENT_BYTES * 4) / 3) + 512;
