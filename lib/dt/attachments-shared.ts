/** DigitalTwin chat attachment limits — safe for client + server bundles. */

export const DT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DT_MAX_ATTACHMENTS = 5;
/** Chat message body cap (route schema). Longer Excel pastes go out as a file. */
export const DT_MAX_CHAT_MESSAGE_CHARS = 32_000;
/**
 * Raw size still embedded as base64 in the chat JSON.
 * Larger files are uploaded straight to storage so the request stays under
 * the platform body limit (~4.5 MB). Base64 would inflate them by a third.
 */
export const DT_MAX_INLINE_ATTACHMENT_BYTES = 1_500_000;
/** Char budget for content + attachment text/base64 in one chat POST. */
export const DT_MAX_CHAT_REQUEST_CHARS = 3_200_000;
export const DT_CHAT_ATTACHMENTS_BUCKET = "dt-chat-attachments";
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

export function isDtSpreadsheetFile(fileName: string, mimeType: string): boolean {
  if (isDtExcelMime(mimeType)) return true;
  const n = fileName.toLowerCase();
  return (
    n.endsWith(".xlsx") ||
    n.endsWith(".xlsm") ||
    n.endsWith(".xls") ||
    n.endsWith(".xlsb")
  );
}

/** Storage object uploaded for this chat (`org_…/chat_…/…`), no path traversal. */
export function isDtChatOwnedStoragePath(
  storagePath: string,
  organisationId: string,
  chatId: string,
): boolean {
  const path = storagePath.trim();
  if (!path || path.length > 500) return false;
  if (!organisationId || !chatId) return false;
  if (organisationId.includes("/") || chatId.includes("/")) return false;
  if (path.includes("..") || path.includes("\\") || path.includes("\0") || path.includes("//")) {
    return false;
  }
  if (path.startsWith("/")) return false;
  const prefix = `org_${organisationId}/chat_${chatId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.endsWith("/");
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
  return /\.(txt|md|markdown|csv|tsv|json|html|htm|xml|svg|css|js|ts|tsx|jsx|yml|yaml|sql|log|rtf|vtt|srt)$/i.test(
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
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm")) {
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

const GENERIC_UPLOAD_MIMES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "application/x-msdownload",
]);

export function isDtGenericUploadMime(mimeType: string): boolean {
  return GENERIC_UPLOAD_MIMES.has(normalizeDtMime(mimeType));
}

function sniffDtMimeFromBytes(bytes: Uint8Array, fileName: string): string | null {
  const fromName = guessDtMimeFromName(fileName, "");
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return fromName || "application/vnd.ms-excel";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return fromName || "application/zip";
  }
  return fromName || null;
}

/**
 * Storage rejects generic types like application/octet-stream on the current bucket.
 * Prefer a real type from the filename or file header.
 */
export function resolveDtStorageMime(
  fileName: string,
  declaredMime: string,
  bytes?: Uint8Array,
): string {
  const sniffed = bytes ? sniffDtMimeFromBytes(bytes, fileName) : null;
  const fromName = guessDtMimeFromName(fileName, "");
  const declared = normalizeDtMime(declaredMime);

  if (sniffed && (isDtGenericUploadMime(declared) || !declared)) return sniffed;
  if (fromName && (isDtGenericUploadMime(declared) || !declared)) return fromName;
  if (declared && !isDtGenericUploadMime(declared)) return declared;
  return sniffed || fromName || "text/plain";
}

export const MAX_ATTACHMENT_BASE64_CHARS =
  Math.ceil((DT_MAX_ATTACHMENT_BYTES * 4) / 3) + 512;
