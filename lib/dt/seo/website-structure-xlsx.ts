/**
 * The agency's Excel template „Seitenstruktur“ → the text the structure parser reads
 * (`parseWebsiteStructure`, indented tree with optional paths). Pure: takes the sheet as rows,
 * so the layouts are testable without a workbook. Three layouts are understood:
 *
 *   1. Level columns: `Ebene 1 | Ebene 2 | Ebene 3 | URL` — a page's name sits in the column
 *      of its depth, deeper rows belong to the last shallower one.
 *   2. Flat list with a level: `Seite | Ebene | Pfad` (level 1 = top).
 *   3. Flat list: `Seite | Pfad` — the depth follows the path.
 *
 * Without a recognisable header the first non-empty cell's column is the depth (layout 1).
 */

import { WEBSITE_STRUCTURE_PATH_RE } from "@/lib/dt/seo/website-structure";

export type SheetCell = string | number | boolean | null | undefined;
export type SheetRows = readonly (readonly SheetCell[])[];

const HEADER_URL = /^(url|urls|link|pfad|path|href|adresse|slug|seiten-?url)$/i;
const HEADER_LABEL =
  /^(seite|seiten|seitenname|seitentitel|titel|title|label|name|men[üu]punkt|menuepunkt|bezeichnung|page|[üu]berschrift|ueberschrift|h1|navigation)$/i;
const HEADER_LEVEL = /^(ebene|level|tiefe|hierarchie|stufe)$/i;
const HEADER_LEVEL_N = /^(ebene|level|stufe|e)\s*(\d+)$/i;
/** How many leading rows may be titles or notes before the header. */
const HEADER_SCAN_ROWS = 15;

function cellText(cell: SheetCell): string {
  if (cell == null || cell === false) return "";
  return String(cell).replace(/\s+/g, " ").trim();
}

function normaliseRows(rows: SheetRows): string[][] {
  return rows
    .map((row) => row.map(cellText))
    .filter((row) => row.some(Boolean));
}

function isPath(text: string): boolean {
  return WEBSITE_STRUCTURE_PATH_RE.test(text);
}

function pathDepth(path: string): number {
  try {
    const pathname = path.startsWith("http") ? new URL(path).pathname : path;
    return Math.max(0, pathname.replace(/\/+$/, "").split("/").filter(Boolean).length - 1);
  } catch {
    return 0;
  }
}

type Header = {
  rowIndex: number;
  labelCol: number;
  urlCol: number;
  levelCol: number;
  levelCols: number[];
};

function findHeader(rows: string[][]): Header | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const row = rows[i]!;
    const header: Header = { rowIndex: i, labelCol: -1, urlCol: -1, levelCol: -1, levelCols: [] };
    row.forEach((cell, col) => {
      if (HEADER_LEVEL_N.test(cell)) header.levelCols.push(col);
      else if (HEADER_URL.test(cell) && header.urlCol < 0) header.urlCol = col;
      else if (HEADER_LABEL.test(cell) && header.labelCol < 0) header.labelCol = col;
      else if (HEADER_LEVEL.test(cell) && header.levelCol < 0) header.levelCol = col;
    });
    if (header.levelCols.length >= 2 || header.labelCol >= 0 || header.urlCol >= 0) return header;
  }
  return null;
}

type Line = { depth: number; label: string; path: string | null };

function pathInRow(row: string[], skip: ReadonlySet<number>): string | null {
  for (let col = 0; col < row.length; col++) {
    if (skip.has(col)) continue;
    if (isPath(row[col]!)) return row[col]!;
  }
  return null;
}

/** Layout 1: the column of the first filled level cell is the depth. */
function linesFromLevelColumns(rows: string[][], levelCols: readonly number[], urlCol: number): Line[] {
  const lines: Line[] = [];
  const skip = new Set(levelCols);
  for (const row of rows) {
    const depth = levelCols.findIndex((col) => Boolean(row[col]));
    if (depth < 0) continue;
    const label = row[levelCols[depth]!]!;
    const path = urlCol >= 0 && row[urlCol] && isPath(row[urlCol]!) ? row[urlCol]! : pathInRow(row, skip);
    lines.push({ depth, label, path });
  }
  return lines;
}

/** Layouts 2 and 3: one page per row; depth from the level column, else from the path. */
function linesFromColumns(rows: string[][], header: Header): Line[] {
  const lines: Line[] = [];
  const skip = new Set([header.labelCol, header.urlCol, header.levelCol].filter((c) => c >= 0));
  for (const row of rows) {
    const rawLabel = header.labelCol >= 0 ? (row[header.labelCol] ?? "") : "";
    const rawPath = header.urlCol >= 0 ? (row[header.urlCol] ?? "") : "";
    const path = isPath(rawPath) ? rawPath : pathInRow(row, skip);
    const label = rawLabel && !isPath(rawLabel) ? rawLabel : "";
    if (!label && !path) continue;
    const levelText = header.levelCol >= 0 ? (row[header.levelCol] ?? "") : "";
    const level = Number.parseInt(levelText, 10);
    const depth = Number.isFinite(level) && level >= 1 ? level - 1 : path ? pathDepth(path) : 0;
    lines.push({ depth, label: label || path!, path });
  }
  return lines;
}

/** No header: like layout 1, but every column may hold a name. */
function linesFromPositions(rows: string[][]): Line[] {
  const lines: Line[] = [];
  for (const row of rows) {
    const depth = row.findIndex((cell) => Boolean(cell) && !isPath(cell));
    const path = pathInRow(row, new Set());
    if (depth < 0) {
      if (path) lines.push({ depth: pathDepth(path), label: path, path });
      continue;
    }
    lines.push({ depth, label: row[depth]!, path });
  }
  return lines;
}

/**
 * Markdown bullets, two spaces per level: the parser's most robust path (it needs no minimum
 * number of indented lines). Depth may only grow by one step per line so the tree stays sane.
 */
function renderLines(lines: readonly Line[]): string {
  const out: string[] = [];
  let previous = -1;
  for (const line of lines) {
    const depth = Math.max(0, Math.min(line.depth, previous + 1));
    previous = depth;
    const label = line.label === line.path ? "" : line.label;
    const text = [label, line.path ?? ""].filter(Boolean).join(" ").trim();
    if (text) out.push(`${"  ".repeat(depth)}- ${text}`);
  }
  return out.join("\n");
}

/** Converts one sheet (rows of cells) into the indented structure text. Throws when nothing is found. */
export function sheetRowsToStructureText(rows: SheetRows): string {
  const clean = normaliseRows(rows);
  if (clean.length === 0) throw new Error("Die Tabelle ist leer.");

  const header = findHeader(clean);
  let lines: Line[];
  if (header && header.levelCols.length >= 2) {
    lines = linesFromLevelColumns(clean.slice(header.rowIndex + 1), header.levelCols, header.urlCol);
  } else if (header) {
    lines = linesFromColumns(clean.slice(header.rowIndex + 1), header);
  } else {
    lines = linesFromPositions(clean);
  }

  const text = renderLines(lines);
  if (!text.trim()) throw new Error("In der Tabelle wurde keine Seitenstruktur erkannt.");
  return text;
}
