import * as XLSX from "xlsx";

import {
  isDtExcelMime,
  isDtTextLikeMime,
  isDtWordMime,
  normalizeDtMime,
} from "@/lib/dt/attachments-shared";

/** True when stored preview is only a "file is attached" stub, not real content. */
export function isDtPlaceholderAttachmentText(text: string | null | undefined): boolean {
  const t = text?.trim() ?? "";
  if (!t) return true;
  return (
    /^\[Datei „.+“ ist angehängt \([^)]*\)\.\]$/i.test(t) ||
    /^\[Datei „.+“ \([^)]*\) — Inhalt nicht als Text lesbar/i.test(t)
  );
}

function looksLikePdf(fileName: string, mimeType: string, bytes: Uint8Array): boolean {
  const norm = normalizeDtMime(mimeType);
  if (norm === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return true;
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const raw = typeof result.text === "string" ? result.text : result.text.join("\n\n");
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const DT_ATTACHMENT_TEXT_PREVIEW_MAX = 40_000;
const TEXT_PREVIEW_MAX = DT_ATTACHMENT_TEXT_PREVIEW_MAX;

export type AttachmentTextExtract =
  | { ok: true; text: string }
  | { ok: false; message: string };

function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "");
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  }
  const sample = bytes.subarray(0, Math.min(80, bytes.length));
  let oddZeros = 0;
  for (let i = 1; i < sample.length; i += 2) {
    if (sample[i] === 0) oddZeros += 1;
  }
  if (sample.length >= 8 && oddZeros >= Math.floor(sample.length / 4)) {
    return new TextDecoder("utf-16le").decode(bytes).replace(/\u0000/g, "");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function binaryPlaceholder(fileName: string, mimeType: string, byteLength: number): string {
  const kb = Math.max(1, Math.round(byteLength / 1024));
  return `[Datei „${fileName}“ (${mimeType || "unbekannt"}, ${kb} KB) — Inhalt nicht als Text lesbar, Datei ist angehängt.]`;
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return (result.value ?? "").replace(/\r\n/g, "\n").trim();
}

function extractExcelText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 8)) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    if (csv.trim()) parts.push(`--- ${sheetName} ---\n${csv}`);
  }
  return parts.join("\n\n").slice(0, TEXT_PREVIEW_MAX);
}

function looksLikeXlsx(fileName: string, mimeType: string): boolean {
  const n = fileName.toLowerCase();
  return isDtExcelMime(mimeType) || n.endsWith(".xlsx") || n.endsWith(".xls");
}

function looksLikeDocx(fileName: string, mimeType: string): boolean {
  const n = fileName.toLowerCase();
  return isDtWordMime(mimeType) || n.endsWith(".docx") || n.endsWith(".doc");
}

/**
 * Best-effort text for the model. Unknown binaries still return a placeholder
 * so the upload is never rejected just because of the file type.
 */
export async function extractTextPreviewFromBytes(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<AttachmentTextExtract> {
  const norm = normalizeDtMime(mimeType);

  if (looksLikeDocx(fileName, norm)) {
    if (fileName.toLowerCase().endsWith(".doc") && !fileName.toLowerCase().endsWith(".docx")) {
      return {
        ok: true,
        text: `[„${fileName}“ ist altes Word-Format (.doc). Bitte als .docx speichern — Datei ist trotzdem angehängt.]`,
      };
    }
    try {
      const text = await extractDocxText(bytes);
      return {
        ok: true,
        text: text
          ? text.slice(0, TEXT_PREVIEW_MAX)
          : `[Word-Datei „${fileName}“ enthält keinen lesbaren Text.]`,
      };
    } catch {
      return { ok: true, text: `[Word-Datei „${fileName}“ konnte nicht gelesen werden, ist aber angehängt.]` };
    }
  }

  if (looksLikeXlsx(fileName, norm)) {
    try {
      const text = extractExcelText(bytes);
      return {
        ok: true,
        text: text || `[Excel-Datei „${fileName}“ enthält keine lesbaren Tabellen.]`,
      };
    } catch {
      return { ok: true, text: `[Excel-Datei „${fileName}“ konnte nicht gelesen werden, ist aber angehängt.]` };
    }
  }

  if (looksLikePdf(fileName, norm, bytes)) {
    try {
      const text = await extractPdfText(bytes);
      if (text) {
        return { ok: true, text: text.slice(0, TEXT_PREVIEW_MAX) };
      }
      return {
        ok: true,
        text: `[PDF „${fileName}“ ist angehängt. Der Text ist nicht auswählbar (Scan/Bild) — Inhalt wird als Dokument mitgelesen.]`,
      };
    } catch {
      return {
        ok: true,
        text: `[PDF „${fileName}“ ist angehängt. Textextraktion fehlgeschlagen — Inhalt wird als Dokument mitgelesen.]`,
      };
    }
  }

  if (isDtTextLikeMime(norm, fileName) || norm === "image/svg+xml") {
    const text = decodeTextBytes(bytes).slice(0, TEXT_PREVIEW_MAX);
    return {
      ok: true,
      text: text.trim()
        ? text
        : `[Textdatei „${fileName}“ ist angehängt, der Inhalt war leer.]`,
    };
  }

  if (norm.startsWith("image/")) {
    return {
      ok: true,
      text: `[Datei „${fileName}“ ist angehängt (${norm || "image"}).]`,
    };
  }

  return { ok: true, text: binaryPlaceholder(fileName, norm || mimeType, bytes.byteLength) };
}
