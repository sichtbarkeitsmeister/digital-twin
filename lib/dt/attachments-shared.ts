/** DigitalTwin chat attachment limits — safe for client + server bundles. */

export const DT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DT_MAX_ATTACHMENTS = 5;
/** Empty accept = every file type in the OS picker (Excel, Word, PDF, HTML, …). */
export const DT_ATTACHMENT_ACCEPT_ATTR = "*/*";

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
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.ms-excel.sheet.macroenabled.12"
  );
}

export function isDtTextLikeMime(mimeType: string, fileName = ""): boolean {
  const m = normalizeDtMime(mimeType);
  const n = fileName.toLowerCase();
  if (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/csv" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/sql"
  ) {
    return true;
  }
  return /\.(txt|md|markdown|csv|json|html|htm|xml|svg|css|js|ts|tsx|jsx|yml|yaml|sql|log|rtf)$/i.test(
    n,
  );
}

export function isDtPreviewableMime(mimeType: string, fileName = ""): boolean {
  const m = normalizeDtMime(mimeType);
  if (isDtMultimodalMime(m) || isDtTextLikeMime(m, fileName)) return true;
  const n = fileName.toLowerCase();
  return n.endsWith(".html") || n.endsWith(".htm") || n.endsWith(".pdf");
}

export function guessDtMimeFromName(fileName: string, fallback = "application/octet-stream"): string {
  const n = fileName.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "text/markdown";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".txt") || n.endsWith(".log")) return "text/plain";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
  if (n.endsWith(".xml")) return "application/xml";
  if (n.endsWith(".css")) return "text/css";
  if (n.endsWith(".js")) return "text/javascript";
  if (n.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (n.endsWith(".doc")) return "application/msword";
  if (n.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (n.endsWith(".zip")) return "application/zip";
  return fallback;
}

export const MAX_ATTACHMENT_BASE64_CHARS =
  Math.ceil((DT_MAX_ATTACHMENT_BYTES * 4) / 3) + 512;
