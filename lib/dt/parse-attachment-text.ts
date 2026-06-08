import * as XLSX from "xlsx";

import { isDtExcelMime, isDtWordMime, normalizeDtMime } from "@/lib/dt/attachments-shared";

const TEXT_PREVIEW_MAX = 20_000;

export function extractTextPreviewFromBytes(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; message: string } {
  const norm = normalizeDtMime(mimeType);

  if (isDtWordMime(norm)) {
    return { ok: false, message: "Word-Dateien werden nicht unterstützt. Bitte als PDF exportieren." };
  }

  if (isDtExcelMime(norm)) {
    try {
      const wb = XLSX.read(bytes, { type: "array" });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames.slice(0, 3)) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
        parts.push(`--- ${sheetName} ---\n${csv}`);
      }
      const text = parts.join("\n\n").slice(0, TEXT_PREVIEW_MAX);
      return text.length > 0
        ? { ok: true, text }
        : { ok: false, message: "Die Excel-Datei enthält keine lesbaren Daten." };
    } catch {
      return { ok: false, message: "Excel-Datei konnte nicht gelesen werden." };
    }
  }

  if (
    norm.startsWith("text/") ||
    norm === "application/json" ||
    norm === "application/csv" ||
    fileName.toLowerCase().endsWith(".csv") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".txt")
  ) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, TEXT_PREVIEW_MAX);
    return { ok: true, text };
  }

  return { ok: false, message: "Dateityp wird nur als Bild oder PDF unterstützt." };
}
