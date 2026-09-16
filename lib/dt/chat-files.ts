import * as XLSX from "xlsx";

import { createPdfFromText } from "@/lib/dt/chat-file-pdf";
import { sanitizeStorageFileSegment } from "@/lib/ai/chat-attachments";

export const DT_MAX_CREATED_FILES = 4;
export const DT_MAX_CREATED_FILE_CHARS = 24_000;

export const DT_CREATED_FILE_FORMATS = [
  "html",
  "markdown",
  "text",
  "csv",
  "json",
  "pdf",
  "xlsx",
] as const;

export type DtCreatedFileFormat = (typeof DT_CREATED_FILE_FORMATS)[number];

export type DtCreatedChatFile = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  title?: string;
};

const FORMAT_MIME: Record<DtCreatedFileFormat, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const FORMAT_EXT: Record<DtCreatedFileFormat, string> = {
  html: "html",
  markdown: "md",
  text: "txt",
  csv: "csv",
  json: "json",
  pdf: "pdf",
  xlsx: "xlsx",
};

export const DT_CHAT_FILE_INSTRUCTIONS = `## Dateien
Wenn der Nutzer eine Datei anhängt, steht der Inhalt im User-Text unter „--- Angehängte Datei: … ---“ (plus Bild/PDF direkt). Behaupte nie, du sähest keine Datei, wenn so ein Block da ist.

Wenn der Nutzer eine Datei zum Anschauen oder Herunterladen braucht, erzeuge sie mit dem Werkzeug create_file — nicht nur als Codeblock in der Chat-Antwort. Behaupte nie, du könntest keine Dateien erstellen.

Formate: html (Vorschau im Chat, z. B. Landingpage oder Tabelle), pdf (druckbares Dokument), xlsx (Excel), csv, markdown, text, json.
HTML gehört in create_file, nicht als rohes HTML in die Chat-Nachricht.
Nach dem Erzeugen kurz sagen, welche Datei bereitliegt; der Nutzer öffnet und lädt sie in der Karte unter der Nachricht.`;

export function isDtCreatedFileFormat(value: unknown): value is DtCreatedFileFormat {
  return (
    typeof value === "string" &&
    (DT_CREATED_FILE_FORMATS as readonly string[]).includes(value)
  );
}

export function formatFromFileName(fileName: string): DtCreatedFileFormat | null {
  const n = fileName.trim().toLowerCase();
  if (n.endsWith(".html") || n.endsWith(".htm")) return "html";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "markdown";
  if (n.endsWith(".txt")) return "text";
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "xlsx";
  return null;
}

export function ensureFileNameExtension(fileName: string, format: DtCreatedFileFormat): string {
  const safe = sanitizeStorageFileSegment(fileName.trim() || `datei.${FORMAT_EXT[format]}`);
  const ext = `.${FORMAT_EXT[format]}`;
  const lower = safe.toLowerCase();
  if (format === "html" && (lower.endsWith(".html") || lower.endsWith(".htm"))) return safe;
  if (format === "markdown" && (lower.endsWith(".md") || lower.endsWith(".markdown"))) return safe;
  if (lower.endsWith(ext)) return safe;
  return `${safe.replace(/\.[a-z0-9]{1,8}$/i, "")}${ext}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapHtmlDocument(content: string, title?: string | null): string {
  const trimmed = content.trim();
  if (/<html[\s>]/i.test(trimmed)) return trimmed;
  const pageTitle = title?.trim() || "Dokument";
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    body { font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.55; color: #1b1b32; max-width: 880px; margin: 32px auto; padding: 0 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cfd8d3; padding: 8px 10px; text-align: left; }
    th { background: #f3fbf7; }
    h1, h2, h3 { line-height: 1.25; }
    pre { overflow: auto; background: #f6f7fb; padding: 12px; border-radius: 8px; }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
}

function parseDelimitedTable(content: string): string[][] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sample = lines.find((l) => l.trim()) ?? "";
  const delimiter = sample.includes("\t") ? "\t" : ",";
  return lines
    .map((line) => {
      if (delimiter === "\t") return line.split("\t");
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          cells.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current);
      return cells;
    })
    .filter((row, idx, all) => row.some((c) => c.trim()) || idx < all.length - 1);
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function createXlsxBytes(content: string): Uint8Array {
  const rows = parseDelimitedTable(content);
  const sheetRows = rows.length > 0 ? rows : [[content]];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, "Tabelle1");
  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(raw);
}

export async function buildCreatedChatFile(input: {
  fileName: string;
  format?: unknown;
  content: string;
  title?: string | null;
}): Promise<{ ok: true; file: DtCreatedChatFile } | { ok: false; message: string }> {
  const content = input.content ?? "";
  if (!content.trim()) {
    return { ok: false, message: "Dateiinhalt fehlt." };
  }
  if (content.length > DT_MAX_CREATED_FILE_CHARS) {
    return {
      ok: false,
      message: `Inhalt zu lang (max. ${DT_MAX_CREATED_FILE_CHARS.toLocaleString("de-DE")} Zeichen).`,
    };
  }

  const fromName = formatFromFileName(input.fileName);
  const format: DtCreatedFileFormat = isDtCreatedFileFormat(input.format)
    ? input.format
    : (fromName ?? "text");
  const fileName = ensureFileNameExtension(input.fileName, format);
  const title = input.title?.trim() || fileName.replace(/\.[a-z0-9]+$/i, "");

  let bytes: Uint8Array;
  if (format === "html") {
    bytes = utf8Bytes(wrapHtmlDocument(content, title));
  } else if (format === "pdf") {
    bytes = await createPdfFromText({ text: content, title });
  } else if (format === "xlsx") {
    bytes = createXlsxBytes(content);
  } else if (format === "json") {
    try {
      const parsed = JSON.parse(content) as unknown;
      bytes = utf8Bytes(`${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      bytes = utf8Bytes(content);
    }
  } else {
    bytes = utf8Bytes(content);
  }

  return {
    ok: true,
    file: {
      fileName,
      mimeType: FORMAT_MIME[format].split(";")[0]!.trim(),
      bytes,
      title,
    },
  };
}

export function createdFileToolResultMessage(file: DtCreatedChatFile): string {
  const kb = Math.max(1, Math.round(file.bytes.byteLength / 1024));
  return `Datei „${file.fileName}“ (${file.mimeType}, ${kb} KB) liegt bereit. Der Nutzer kann sie in der Karte unter deiner Nachricht öffnen und herunterladen.`;
}

export function mergeCreatedChatFiles(
  primary: DtCreatedChatFile[],
  extra: DtCreatedChatFile[],
): DtCreatedChatFile[] {
  const out: DtCreatedChatFile[] = [];
  const seen = new Set<string>();
  for (const file of [...primary, ...extra]) {
    const key = file.fileName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
    if (out.length >= DT_MAX_CREATED_FILES) break;
  }
  return out;
}
