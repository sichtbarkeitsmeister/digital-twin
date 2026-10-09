/**
 * Reads a Seitenstruktur upload for Texte in the browser. Spreadsheets are sent as sheets of
 * rows, so the server's briefing parser (`excel-structure.ts`) sees every column (keywords,
 * H1 options, user questions); every other format goes as text, like under SEO → Struktur.
 */

import type { SheetInput } from "@/lib/dt/content/excel-structure";
import { readWebsiteStructureFile, WEBSITE_STRUCTURE_FILE_ACCEPT } from "@/lib/dt/seo/read-website-structure-file";

export const CONTENT_STRUCTURE_FILE_ACCEPT = WEBSITE_STRUCTURE_FILE_ACCEPT;

export const CONTENT_STRUCTURE_FILE_HINT =
  "Excel-Briefing „Webseitenstruktur“ (.xlsx, .xls, .csv) mit URL, Startseite, Ebene 1, Ebene 2, Traffic, Keywords, H1-Optionen und Nutzerfragen; die DT-Vorlage „Ebene 1 … n“ geht ebenfalls, dann ohne Briefing. Auch .txt, .md, .json, Sitemap-.xml oder .docx (nur Seitennamen und Pfade).";

export type ContentStructureFilePayload = {
  filename: string;
  mimeType: string | null;
  sheets?: SheetInput[];
  text?: string;
};

/** Same caps as the route's schema; a sheet beyond them is cut, not rejected. */
const MAX_SHEETS = 20;
const MAX_ROWS = 3_000;
const MAX_COLS = 60;
const MAX_CELL = 5_000;

function isSpreadsheet(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsm") ||
    name.endsWith(".csv") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "text/csv"
  );
}

function cell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, MAX_CELL);
}

async function readSheets(file: File): Promise<SheetInput[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) throw new Error(`„${file.name}“ ist leer oder noch nicht vollständig geladen.`);
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets: SheetInput[] = [];
  for (const name of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    sheets.push({
      name,
      rows: rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS).map(cell)),
    });
  }
  if (sheets.length === 0) throw new Error(`„${file.name}“ enthält kein Tabellenblatt.`);
  return sheets;
}

export async function readContentStructureFile(file: File): Promise<ContentStructureFilePayload> {
  const mimeType = file.type || null;
  if (isSpreadsheet(file)) return { filename: file.name, mimeType, sheets: await readSheets(file) };
  const { text } = await readWebsiteStructureFile(file);
  return { filename: file.name, mimeType, text };
}
