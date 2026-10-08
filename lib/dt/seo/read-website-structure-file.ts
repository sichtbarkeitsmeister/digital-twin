/**
 * Reads a Seitenstruktur upload in the browser and returns the text the structure parser
 * understands. Excel (the agency template) is converted sheet → indented tree here, so the
 * server keeps one parser for every format.
 */

import { sheetRowsToStructureText, type SheetRows } from "@/lib/dt/seo/website-structure-xlsx";
import { readQuestionnaireFileText } from "@/lib/surveys/read-questionnaire-file-text";

export const WEBSITE_STRUCTURE_FILE_ACCEPT = [
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".xml",
  ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

export const WEBSITE_STRUCTURE_FILE_HINT =
  "Excel-Vorlage „Seitenstruktur“ (.xlsx), .csv, .md, .txt, .json, Sitemap-.xml oder .docx";

export type WebsiteStructureFileText = {
  text: string;
  filename: string;
  mimeType: string | null;
};

function isExcel(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsm") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel"
  );
}

function isWord(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".docx") ||
    name.endsWith(".doc") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

async function readExcel(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) throw new Error(`„${file.name}“ ist leer oder noch nicht vollständig geladen.`);
  const workbook = XLSX.read(buffer, { type: "array" });
  let lastError: Error | null = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as SheetRows;
    try {
      return sheetRowsToStructureText(rows);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `In „${file.name}“ wurde keine Seitenstruktur erkannt${lastError ? ` (${lastError.message})` : ""}. Erwartet: Spalten „Ebene 1 … n“ oder „Seite / Pfad“.`,
  );
}

export async function readWebsiteStructureFile(file: File): Promise<WebsiteStructureFileText> {
  const mimeType = file.type || null;
  if (isExcel(file)) return { text: await readExcel(file), filename: file.name, mimeType };
  if (isWord(file)) return { text: await readQuestionnaireFileText(file), filename: file.name, mimeType };
  const text = (await file.text()).trim();
  if (!text) throw new Error(`„${file.name}“ ist leer.`);
  return { text, filename: file.name, mimeType };
}
