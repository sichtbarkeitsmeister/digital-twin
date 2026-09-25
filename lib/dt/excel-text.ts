import * as XLSX from "xlsx";

/** Rows parsed per sheet. Enough for a list, small enough to avoid blowing the function memory. */
export const EXCEL_MAX_ROWS = 2000;
export const EXCEL_MAX_COLS = 40;
export const EXCEL_MAX_SHEETS = 8;

const TRUNCATION_NOTE =
  "[Hinweis: Die Tabelle wurde für den Chat gekürzt. Es sind nur die ersten Zeilen enthalten.]";

/**
 * SheetJS reads `type: "array"` from the underlying ArrayBuffer, ignoring
 * byteOffset. Node Buffers are often views into a shared pool, so copy first.
 */
function standaloneBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function sheetToTsv(sheet: XLSX.WorkSheet): { text: string; capped: boolean } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });
  const capped = rows.length >= EXCEL_MAX_ROWS;
  const lines = rows.slice(0, EXCEL_MAX_ROWS).map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return cells.slice(0, EXCEL_MAX_COLS).map(cellText).join("\t").replace(/\t+$/g, "");
  });
  return { text: lines.filter((line) => line.length > 0).join("\n"), capped };
}

function htmlTableFallback(bytes: Uint8Array): string {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 200_000));
  const asText = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  const head = asText.slice(0, 400).toLowerCase();
  if (!head.includes("<table") && !head.includes("<html") && !head.includes("<?xml")) {
    return "";
  }
  return asText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Tab-separated text of the first sheets. Throws when the bytes are not a workbook. */
export function extractExcelText(bytes: Uint8Array): string {
  let truncated = false;
  try {
    const wb = XLSX.read(standaloneBytes(bytes), {
      type: "array",
      cellStyles: false,
      cellNF: false,
      cellHTML: false,
      cellDates: false,
      sheetRows: EXCEL_MAX_ROWS,
      bookVBA: false,
    });
    const parts: string[] = [];
    const names = wb.SheetNames.slice(0, EXCEL_MAX_SHEETS);
    if (wb.SheetNames.length > EXCEL_MAX_SHEETS) truncated = true;
    for (const sheetName of names) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const rendered = sheetToTsv(sheet);
      if (rendered.capped) truncated = true;
      if (rendered.text.trim()) parts.push(`--- ${sheetName} ---\n${rendered.text}`);
    }
    if (parts.length > 0) {
      const body = parts.join("\n\n");
      return truncated ? `${TRUNCATION_NOTE}\n\n${body}` : body;
    }
  } catch {
    // HTML/XML workbooks exported from Excel fall through below.
  }

  const html = htmlTableFallback(bytes);
  if (html) return html;
  throw new Error("EXCEL_UNREADABLE");
}
