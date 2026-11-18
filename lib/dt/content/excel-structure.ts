/**
 * The Excel-Seitenstruktur as a briefing for Texte, ported from the old Content-Agent's
 * `src/importer.py`. Pure: takes sheets as rows of cells, so every layout is testable
 * without a workbook; the browser reads the file (`read-content-structure-file.ts`), the
 * route stores the result (`/api/dt/content/structure`).
 *
 * Two layouts are understood:
 *
 *   1. The old agency briefing (sheet „Webseitenstruktur“, else the first sheet), columns A–H:
 *      URL | Startseite | Ebene 1 (L1) | Ebene 2 (L2) | Traffic | Keywords | H1-Optionen | Nutzerfragen
 *      The page name sits in the column of its role; a Ebene-2 row belongs to the last
 *      Ebene-1 row above it. Further level columns („Ebene 3“, „Ebene 4“ …) are read too: a
 *      name in Ebene n is n − 1 deep and belongs to the last Ebene-1 row above it as well.
 *      Extra columns „KI-Prompt / Prompt / Content-Prompt“ and the writer's notes („Themen und
 *      Hinweise für den Texter“, any header with „Themen“ or „Hinweis“) are read when their
 *      header exists; together they are the page's briefing text (`ki_prompt`).
 *      Without a header the columns are taken by position (`rawPagesByPosition`).
 *   2. The DigitalTwin template „Ebene 1 … n“ (+ optional URL), plus the briefing columns
 *      F/G/H when their headers exist. Depth 0 is a Hauptsilo (or the Startseite), deeper
 *      rows are Unterseiten of the nearest depth-0 row.
 *
 * A sheet named „Legende“ (or „Regeln“, „Hinweise“ …) holds rules for every page: its rows are
 * returned as `legend` and go into the organisation's „Hinweise zum Texten“.
 *
 * Nothing is invented: a missing cell stays empty, a keyword without volume has none.
 * The SEO parser (`lib/dt/seo/website-structure*.ts`) is not used here; SEO → Struktur keeps
 * its own name/path flattening. `briefingToStructureText` renders the same pages as an
 * indented tree so that parser can store an outline that matches the Texte table.
 */

import { keywordJunkReason } from "@/lib/dt/content/keyword-compare";
import {
  derivePageType,
  type ContentPageRole,
  type ContentPageType,
} from "@/lib/dt/content/page-types";
import { slugify } from "@/lib/dt/content/render";
import type { SheetCell, SheetRows } from "@/lib/dt/seo/website-structure-xlsx";

export type ContentKeyword = { text: string; volume?: number };
/**
 * Where a page's keywords come from when not from the Seitenstruktur (Excel): the DigitalTwin's
 * suggestion („Keywords analysieren“) or the editor's own entry in the page window. Absent for
 * keywords of the Seitenstruktur, which go first.
 */
export type ContentKeywordSource = "analyse" | "manuell";
/**
 * `sorted`: the DigitalTwin assigned the roles („Keywords analysieren“). The Excel names the
 * keywords of a page in one cell without saying which one is the main keyword (the first one is
 * only a placeholder); a list from the Excel without `sorted` still waits for that assignment.
 */
export type ContentPageKeywords = {
  main: ContentKeyword;
  secondary: ContentKeyword[];
  source?: ContentKeywordSource;
  sorted?: true;
  /** The Zwilling's one-sentence reason for the main keyword (shown in the Keywords-Übersicht). */
  reason?: string;
};

/** One page as the Excel briefs it; the store writes it onto `dt_content_pages`. */
export type ContentBriefingPage = {
  slug: string;
  name: string;
  path: string | null;
  /** 0 Startseite, 1 Hauptsilo, 2 Unterseite, 3 and more for „Ebene 3“ and deeper (both layouts). */
  level: number;
  position: number;
  page_role: ContentPageRole;
  page_type: ContentPageType;
  pillar_name: string | null;
  /** The Excel URL when the cell held one. */
  source_url: string | null;
  estimated_traffic: number | null;
  keywords: ContentPageKeywords | null;
  h1_options: string[];
  user_questions: string[];
  ki_prompt: string | null;
  internal_link_targets: string[];
};

export type SheetInput = { name: string; rows: SheetRows };

export type ParsedContentStructure = {
  pages: ContentBriefingPage[];
  /** Name of the sheet the pages came from. */
  sheet: string;
  layout: "briefing" | "template";
  /** Whether the sheet had any of the briefing columns (keywords, H1 options, questions). */
  briefing: boolean;
  /**
   * The rules of the workbook's legend sheet („Legende“: „keine Preise“, „immer Sie“ …), one per
   * entry. They hold for every page and go into the organisation's „Hinweise zum Texten“.
   */
  legend: string[];
};

export const CONTENT_STRUCTURE_MAX_PAGES = 300;
const MAX_LIST_ITEMS = 40;
const MAX_CELL_CHARS = 4_000;
const MAX_LINK_TARGETS = 30;
/** How many leading rows may hold a title or notes before the header. */
const HEADER_SCAN_ROWS = 15;

// --- cells ----------------------------------------------------------------------------------

export function cellText(cell: SheetCell): string {
  if (cell == null || cell === false) return "";
  return String(cell).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, MAX_CELL_CHARS);
}

const URL_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/i;

export function isUrlCell(text: string): boolean {
  return URL_RE.test(text.trim());
}

/** `https://x.de/privatumzug/` → `/privatumzug`; a bare path is normalised the same way; the root is `/`. */
export function pathOfUrlCell(text: string): string | null {
  const t = text.trim();
  if (!isUrlCell(t)) return null;
  try {
    const pathname = t.startsWith("/") ? t : new URL(t).pathname;
    const clean = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "");
    return clean ? decodeSafe(clean) : "/";
  } catch {
    return null;
  }
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Parses a volume cell or suffix: „590“, „1.200“, „1 200“, „2,5k“ → number; anything else → undefined. */
export function parseVolume(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return undefined;
  const k = t.match(/^(\d+(?:[.,]\d+)?)k$/);
  if (k) return Math.round(Number(k[1]!.replace(",", ".")) * 1_000);
  const plain = t.replace(/\./g, "").replace(/,/g, "");
  if (!/^\d+$/.test(plain)) return undefined;
  const n = Number(plain);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * „Privatumzug (590), Privatumzüge (260)“ → main = Privatumzug (590), secondary = [Privatumzüge (260)].
 * Separators: comma, semicolon, line break (a comma inside the parentheses is not one).
 * The volume is only set when the cell carries one.
 */
export function parseKeywordsCell(text: string): ContentPageKeywords | null {
  const parts = cellText(text)
    .split(/[;\n]|,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean);
  const keywords: ContentKeyword[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const m = part.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const raw = (m ? m[1] : part).replace(/^[-•*\d.)\s]+/, "").trim();
    // A header or description the Excel left in the cell („geschätzter Traffic bei Google / Monat“) is no keyword.
    if (!raw || keywordJunkReason(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const volume = m ? parseVolume(m[2] ?? "") : undefined;
    keywords.push(volume != null ? { text: raw, volume } : { text: raw });
    if (keywords.length >= MAX_LIST_ITEMS) break;
  }
  if (keywords.length === 0) return null;
  const [main, ...secondary] = keywords;
  return { main: main!, secondary };
}

const LINE_PREFIX_RE = /^(?:option\s*[a-z0-9]+\s*[:.)-]|variante\s*[a-z0-9]+\s*[:.)-]|[a-z]\s*[:.)]|\d+\s*[:.)]|[-•*–—]|h1\s*[:.)-])\s*/i;

/** One entry per line, bullets/numbering/„Option A:“ stripped, quotes removed, duplicates dropped. */
export function parseLinesCell(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of cellText(text).split(/\n|\s*\|\s*/)) {
    let line = raw.trim();
    for (let i = 0; i < 2; i++) line = line.replace(LINE_PREFIX_RE, "").trim();
    line = line.replace(/^["„“»«‚‘']+|["„“»«‚‘']+$/g, "").trim();
    if (line.length < 3) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

// --- headers ----------------------------------------------------------------------------------

const H_URL = /^(url|urls|link|links|pfad|path|href|adresse|seiten-?url)$/i;
const H_STARTSEITE = /^(startseite|home|homepage|start)$/i;
/** Non-numeric names for the two silo levels of the old briefing. */
const H_L1 = /^(hauptsilo|hauptsilos|haupt-?seite|silo|silos|pillar|kategorie|hauptkategorie)$/i;
const H_L2 = /^(unterseite|unter-?seiten|supporting|unterkategorie)$/i;
/** „Ebene 1“, „Ebene-2“, „L1“, „Level 3“, „E2“: both layouts number their levels. */
const H_LEVEL_N = /^(ebene|level|stufe|e|l)[\s-]*(\d+)$/i;
const H_TRAFFIC = /^(traffic|besucher|visits|sessions|sichtbarkeit|suchvolumen gesamt)$/i;
const H_KEYWORDS = /^(keywords?|suchbegriffe?|hauptkeyword|keyword\s*\(.*\)|keywords\s*\(.*\))$/i;
const H_H1 = /^(h1|h1-?optionen|h1 optionen|h1-?vorschl[äa]ge|[üu]berschrift(en)?|ueberschrift(en)?|titel-?optionen)$/i;
const H_QUESTIONS = /^(nutzerfragen|fragen|user questions|w-?fragen|google-?fragen|suchfragen|faq)$/i;
const H_PROMPT = /^(ki-?prompt|prompt|content-?prompt|ki-?anweisung|anweisung|briefing|hinweise?)$/i;
/**
 * The editors' notes for the writer in their own words: any header with „Themen“ or „Hinweis“
 * in it („Themen und Hinweise für den Texter“, „Hinweise Texter“, „Themen“, „Texter-Hinweise“).
 * Checked after every other column, so „Keywords (Hinweis)“ stays the keyword column.
 */
const H_TEXTER_NOTES = /\b(themen|thema|hinweis\w*|anmerkung\w*|texter\w*|redaktion\w*)\b/i;

type Header = {
  rowIndex: number;
  url: number;
  startseite: number;
  l1: number;
  l2: number;
  /** Template layout: one column per depth. */
  levels: number[];
  /** Briefing layout: the level columns beyond Ebene 2 („Ebene 3“ is depth 2). */
  deeper: Array<{ col: number; depth: number }>;
  traffic: number;
  keywords: number;
  h1: number;
  questions: number;
  /** Every column for the writer („KI-Prompt“, „Themen und Hinweise für den Texter“ …), left to right. */
  prompts: number[];
};

function emptyHeader(rowIndex: number): Header {
  return { rowIndex, url: -1, startseite: -1, l1: -1, l2: -1, levels: [], deeper: [], traffic: -1, keywords: -1, h1: -1, questions: -1, prompts: [] };
}

type HeaderLayout = { header: Header; layout: ParsedContentStructure["layout"] };

/**
 * Which row is the header and which layout it announces. A „Startseite“ column makes it the
 * old briefing (its level columns are Ebene 1, Ebene 2 and any further „Ebene n“); two or more
 * level columns without one make it the DT template; a single name column next to a URL column
 * is a flat list.
 */
function findHeader(rows: string[][]): HeaderLayout | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const header = emptyHeader(i);
    const levelCols: Array<{ col: number; n: number }> = [];
    rows[i]!.forEach((cell, col) => {
      const c = cell.replace(/\s+/g, " ").trim();
      if (!c) return;
      if (H_URL.test(c) && header.url < 0) header.url = col;
      else if (H_STARTSEITE.test(c) && header.startseite < 0) header.startseite = col;
      else if (H_LEVEL_N.test(c)) levelCols.push({ col, n: Number(c.match(H_LEVEL_N)![2]) });
      else if (H_L1.test(c) && header.l1 < 0) header.l1 = col;
      else if (H_L2.test(c) && header.l2 < 0) header.l2 = col;
      else if (H_TRAFFIC.test(c) && header.traffic < 0) header.traffic = col;
      else if (H_KEYWORDS.test(c) && header.keywords < 0) header.keywords = col;
      else if (H_H1.test(c) && header.h1 < 0) header.h1 = col;
      else if (H_QUESTIONS.test(c) && header.questions < 0) header.questions = col;
      else if (H_PROMPT.test(c) || H_TEXTER_NOTES.test(c)) header.prompts.push(col);
    });
    const sorted = levelCols.sort((a, b) => a.n - b.n);
    header.levels = sorted.map((l) => l.col);
    if (header.l1 < 0) header.l1 = sorted.find((l) => l.n === 1)?.col ?? -1;
    if (header.l2 < 0) header.l2 = sorted.find((l) => l.n === 2)?.col ?? -1;
    header.deeper = sorted.filter((l) => l.n >= 3 && l.col !== header.l1 && l.col !== header.l2).map((l) => ({ col: l.col, depth: l.n - 1 }));

    if (header.startseite >= 0 && (header.l1 >= 0 || header.l2 >= 0)) return { header, layout: "briefing" };
    if (header.startseite < 0 && header.levels.length >= 2) return { header, layout: "template" };
    if (header.l1 >= 0 && header.url >= 0) return { header, layout: "briefing" };
  }
  return null;
}

// --- rows → pages -----------------------------------------------------------------------------

type RawPage = {
  name: string;
  /** Column depth: 0 Startseite / Hauptsilo level, 1 Unterseite, 2 third level. */
  depth: number;
  isHome: boolean;
  url: string | null;
  traffic: number | null;
  keywords: ContentPageKeywords | null;
  h1_options: string[];
  user_questions: string[];
  ki_prompt: string | null;
};

function normaliseRows(rows: SheetRows): string[][] {
  return rows.map((row) => row.map(cellText)).filter((row) => row.some(Boolean));
}

function at(row: string[], col: number): string {
  return col >= 0 ? (row[col] ?? "") : "";
}

function looksLikeHome(name: string, url: string | null): boolean {
  return /^(startseite|home|homepage|start)$/i.test(name.trim()) || pathOfUrlCell(url ?? "") === "/";
}

function briefingFields(row: string[], header: Header): Pick<RawPage, "traffic" | "keywords" | "h1_options" | "user_questions" | "ki_prompt"> {
  const traffic = parseVolume(at(row, header.traffic));
  return {
    traffic: traffic ?? null,
    keywords: header.keywords >= 0 ? parseKeywordsCell(at(row, header.keywords)) : null,
    h1_options: header.h1 >= 0 ? parseLinesCell(at(row, header.h1)) : [],
    user_questions: header.questions >= 0 ? parseLinesCell(at(row, header.questions)) : [],
    // Several such columns („KI-Prompt“ next to „Themen und Hinweise für den Texter“) are one briefing text.
    ki_prompt:
      header.prompts
        .map((col) => at(row, col).trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, MAX_CELL_CHARS) || null,
  };
}

/** What the Startseite column holds instead of the home page's name. */
const HOME_MARKER_RE = /^(x|ja|yes|✓|✔)$/i;

/** Layout 1: the name sits in Startseite, Ebene 1, Ebene 2 or a further level column. */
function rawPagesFromBriefingColumns(rows: string[][], header: Header): RawPage[] {
  const out: RawPage[] = [];
  for (const row of rows) {
    const home = at(row, header.startseite);
    const l1 = at(row, header.l1);
    const l2 = at(row, header.l2);
    const deep = header.deeper.find((d) => Boolean(at(row, d.col)) && !isUrlCell(at(row, d.col)));
    const url = isUrlCell(at(row, header.url)) ? at(row, header.url) : null;
    let name = "";
    let depth = 0;
    let isHome = false;
    if (home) {
      // The Startseite column holds the home page's name, a marker („x“, „ja“) or its URL.
      isHome = true;
      const marker = HOME_MARKER_RE.test(home) || isUrlCell(home);
      name = marker ? (!isUrlCell(l1) && l1) || (!isUrlCell(l2) && l2) || "Startseite" : home;
    } else if (l1 && !isUrlCell(l1)) {
      name = l1;
      depth = 0;
    } else if (l2 && !isUrlCell(l2)) {
      name = l2;
      depth = 1;
    } else if (deep) {
      // „Ebene 3“ and deeper: without this the row was skipped and the page never reached Texte.
      name = at(row, deep.col);
      depth = deep.depth;
    } else {
      continue;
    }
    const rowUrl = url ?? (isUrlCell(home) ? home : null);
    out.push({ name, depth, isHome: isHome || looksLikeHome(name, rowUrl), url: rowUrl, ...briefingFields(row, header) });
  }
  return out;
}

/** Layout 2: the DT template, the column of the first filled level cell is the depth. */
function rawPagesFromLevelColumns(rows: string[][], header: Header): RawPage[] {
  const out: RawPage[] = [];
  const levelSet = new Set(header.levels);
  for (const row of rows) {
    const depth = header.levels.findIndex((col) => Boolean(row[col]) && !isUrlCell(row[col]!));
    if (depth < 0) continue;
    const name = row[header.levels[depth]!]!;
    let url: string | null = isUrlCell(at(row, header.url)) ? at(row, header.url) : null;
    if (!url) {
      const loose = row.find((cell, col) => !levelSet.has(col) && isUrlCell(cell));
      url = loose ?? null;
    }
    out.push({ name, depth, isHome: depth === 0 && looksLikeHome(name, url), url, ...briefingFields(row, header) });
  }
  return out;
}

/** How many level columns a sheet without a header may have after the first candidate. */
const MAX_POSITIONAL_LEVELS = 6;

const isNameCell = (cell: string | undefined): cell is string => Boolean(cell) && !isUrlCell(cell!);

/**
 * A sheet without a header: which columns from `from` on are level columns. In a level column a
 * page name stands alone in its row; a briefing column (traffic, keywords …) stands next to the
 * name of its page. So a column counts while some row has its first name there (a bare number is
 * no name: that is a traffic cell) and no row has it filled next to a name left of it (from
 * `first`, a Startseite marker left out). The columns must follow each other.
 */
function positionalLevelColumns(rows: string[][], first: number, from: number): number[] {
  const cols: number[] = [];
  for (let col = from; col < from + MAX_POSITIONAL_LEVELS; col++) {
    let alone = false;
    let beside = false;
    for (const row of rows) {
      if (!isNameCell(row[col])) continue;
      if (row.slice(first, col).some((cell) => isNameCell(cell) && !HOME_MARKER_RE.test(cell))) {
        beside = true;
        break;
      }
      if (parseVolume(row[col]!) === undefined) alone = true;
    }
    if (!alone || beside) break;
    cols.push(col);
  }
  return cols;
}

/**
 * The old briefing without its header row and without URLs in column A: column A is the
 * Startseite column (every cell in it is the home page: its name or a marker) and the page
 * names stand in the columns right of it. Null when the sheet does not look like that.
 */
function positionalBriefingWithoutUrls(rows: string[][]): Header | null {
  const homeCells = rows.map((row) => row[0] ?? "").filter(Boolean);
  if (homeCells.length === 0 || !homeCells.every((cell) => HOME_MARKER_RE.test(cell) || looksLikeHome(cell, null))) return null;
  const levels = positionalLevelColumns(rows, 0, 1);
  if (levels.length === 0) return null;
  let next = levels[levels.length - 1]! + 1;
  const header: Header = {
    ...emptyHeader(-1),
    startseite: 0,
    l1: levels[0]!,
    l2: levels[1] ?? -1,
    deeper: levels.slice(2).map((col, i) => ({ col, depth: i + 2 })),
  };
  // Right of the levels, in the order of the briefing: Traffic (only when the column holds numbers), Keywords, H1-Optionen, Nutzerfragen.
  const numbers = rows.map((row) => row[next] ?? "").filter(Boolean);
  if (numbers.length > 0 && numbers.every((cell) => parseVolume(cell) !== undefined)) header.traffic = next++;
  header.keywords = next;
  header.h1 = next + 1;
  header.questions = next + 2;
  return header;
}

/**
 * No header. URLs in column A: the old briefing, columns A–H by position as the importer
 * read them (URL | Startseite | Ebene 1 | Ebene 2 | Traffic | Keywords | H1-Optionen |
 * Nutzerfragen); level columns after Ebene 2 („Ebene 3“ …) are recognised by their content
 * (`positionalLevelColumns`) and move the briefing columns to the right. A Startseite column in
 * column A without URLs is the same briefing without its URL column. Otherwise the DT template
 * without its header row: the column is the depth.
 */
function rawPagesByPosition(rows: string[][]): { raw: RawPage[]; layout: ParsedContentStructure["layout"] } {
  const urlsInFirstColumn = rows.some((row) => isUrlCell(row[0] ?? ""));
  if (urlsInFirstColumn) {
    const extra = positionalLevelColumns(rows, 1, 4);
    const shift = extra.length;
    const header: Header = {
      ...emptyHeader(-1),
      url: 0,
      startseite: 1,
      l1: 2,
      l2: 3,
      deeper: extra.map((col, i) => ({ col, depth: i + 2 })),
      traffic: 4 + shift,
      keywords: 5 + shift,
      h1: 6 + shift,
      questions: 7 + shift,
    };
    return { raw: rawPagesFromBriefingColumns(rows, header), layout: "briefing" };
  }
  const briefing = positionalBriefingWithoutUrls(rows);
  if (briefing) return { raw: rawPagesFromBriefingColumns(rows, briefing), layout: "briefing" };
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header: Header = { ...emptyHeader(-1), levels: Array.from({ length: Math.min(width, 6) }, (_, i) => i) };
  return { raw: rawPagesFromLevelColumns(rows, header), layout: "template" };
}

/** Same slug rules as the structure flattener of the store, so both paths meet on one row. */
export function contentPageSlug(name: string, path: string | null, isHome: boolean): string {
  if (isHome) return "startseite";
  const segment = path?.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  return slugify(decodeSafe(segment)) || slugify(name) || "seite";
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

export type BriefingOptions = { cities?: readonly string[] };

/**
 * Roles, types, pillars, slugs and link targets for a list of raw rows in sheet order.
 * A row deeper than „one below the last Hauptsilo“ still belongs to that Hauptsilo.
 */
function buildPages(raw: readonly RawPage[], options: BriefingOptions): ContentBriefingPage[] {
  const used = new Set<string>();
  const pages: ContentBriefingPage[] = [];
  let pillar: ContentBriefingPage | null = null;
  const children = new Map<string, ContentBriefingPage[]>();

  for (const row of raw) {
    if (pages.length >= CONTENT_STRUCTURE_MAX_PAGES) break;
    const name = row.name.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const path = row.url ? pathOfUrlCell(row.url) : null;
    const role: ContentPageRole = row.isHome ? "startseite" : row.depth === 0 ? "pillar" : "supporting";
    const pillarName = role === "supporting" ? (pillar?.name ?? null) : null;
    const page: ContentBriefingPage = {
      slug: uniqueSlug(contentPageSlug(name, path, role === "startseite"), used),
      name,
      path,
      level: role === "startseite" ? 0 : row.depth + 1,
      position: pages.length,
      page_role: role,
      page_type: derivePageType({ name, role, pillarName, path, cities: options.cities }),
      pillar_name: pillarName,
      source_url: row.url && /^https?:\/\//i.test(row.url) ? row.url.trim() : null,
      estimated_traffic: row.traffic,
      keywords: row.keywords,
      h1_options: row.h1_options,
      user_questions: row.user_questions,
      ki_prompt: row.ki_prompt,
      internal_link_targets: [],
    };
    pages.push(page);
    if (role === "pillar") {
      pillar = page;
      children.set(page.slug, []);
    } else if (role === "supporting" && pillar) {
      children.get(pillar.slug)!.push(page);
    }
  }

  const writable = (p: ContentBriefingPage) => p.page_type !== "nicht_bearbeiten";
  const pillars = pages.filter((p) => p.page_role === "pillar" && writable(p));
  for (const page of pages) {
    let targets: string[] = [];
    if (page.page_role === "startseite") {
      targets = pillars.map((p) => p.name);
    } else if (page.page_role === "pillar") {
      const kids = (children.get(page.slug) ?? []).filter(writable).map((p) => p.name);
      targets = kids.length > 0 ? kids : pillars.filter((p) => p !== page).map((p) => p.name);
    } else if (page.page_role === "supporting") {
      const owner = page.pillar_name ? pages.find((p) => p.page_role === "pillar" && p.name === page.pillar_name) : null;
      const siblings = owner ? (children.get(owner.slug) ?? []).filter((p) => p !== page && writable(p)).map((p) => p.name) : [];
      targets = [...(page.pillar_name ? [page.pillar_name] : []), ...siblings];
    }
    page.internal_link_targets = [...new Set(targets.filter((t) => t !== page.name))].slice(0, MAX_LINK_TARGETS);
  }
  return pages;
}

/** One sheet → briefing pages. Throws when no page is found. */
export function parseContentStructureSheet(
  rows: SheetRows,
  options: BriefingOptions = {},
): Omit<ParsedContentStructure, "sheet" | "legend"> {
  const clean = normaliseRows(rows);
  if (clean.length === 0) throw new Error("Die Tabelle ist leer.");
  const found = findHeader(clean);
  let raw: RawPage[];
  let layout: ParsedContentStructure["layout"];
  if (found?.layout === "template") {
    raw = rawPagesFromLevelColumns(clean.slice(found.header.rowIndex + 1), found.header);
    layout = "template";
  } else if (found) {
    raw = rawPagesFromBriefingColumns(clean.slice(found.header.rowIndex + 1), found.header);
    layout = "briefing";
  } else {
    ({ raw, layout } = rawPagesByPosition(clean));
  }
  const pages = buildPages(raw, options);
  if (pages.length === 0) throw new Error("In der Tabelle wurde keine Seitenstruktur erkannt.");
  const briefing = pages.some((p) => p.keywords || p.h1_options.length > 0 || p.user_questions.length > 0);
  return { pages, layout, briefing };
}

const PREFERRED_SHEET_RE = /^(webseitenstruktur|seitenstruktur|struktur|website-?struktur|seiten)$/i;

const LEGEND_SHEET_RE = /legende|regeln|vorgaben|hinweise|erl(?:ä|ae)uterung|anleitung|lies ?mich|read ?me/i;
/** A legend holds a handful of rules, not a text: more rows than this are cut. */
export const CONTENT_LEGEND_MAX_RULES = 60;
const LEGEND_RULE_MAX_CHARS = 400;
/** A row that only names the sheet or its columns („Legende“, „Regel | Bedeutung“) is no rule. */
const LEGEND_TITLE_RE = /^(legende|regeln?|vorgaben?|hinweise?|erl(?:ä|ae)uterung(?:en)?|bedeutung|beschreibung|spalte|farbe|k(?:ü|ue)rzel|abk(?:ü|ue)rzung)$/i;

/**
 * The rules of a legend sheet, one per row: the filled cells of the row, the first as the
 * rule's name when a second explains it („Preise | keine Preise nennen“ → „Preise: keine Preise
 * nennen“). Title rows and repeats are left out.
 */
export function parseLegendRows(rows: SheetRows): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const cells = row.map((cell) => cellText(cell).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (cells.length === 0 || cells.every((c) => LEGEND_TITLE_RE.test(c))) continue;
    const rule = (cells.length === 1 ? cells[0]! : `${cells[0]!.replace(/[:：]\s*$/, "")}: ${cells.slice(1).join(" – ")}`).slice(0, LEGEND_RULE_MAX_CHARS).trim();
    const key = rule.toLowerCase();
    if (rule.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
    if (out.length >= CONTENT_LEGEND_MAX_RULES) break;
  }
  return out;
}

/** The rules of every legend sheet of the workbook (by sheet name), without the sheet the pages came from. */
export function parseContentLegend(sheets: readonly SheetInput[], pagesSheet: string | null): string[] {
  const rules = sheets
    .filter((sheet) => sheet.name !== pagesSheet && LEGEND_SHEET_RE.test(sheet.name))
    .flatMap((sheet) => parseLegendRows(sheet.rows));
  return [...new Set(rules)].slice(0, CONTENT_LEGEND_MAX_RULES);
}

/** The sheet „Webseitenstruktur“ first, else the first sheet that yields pages. The legend sheet is read on top. */
export function parseContentStructureWorkbook(
  sheets: readonly SheetInput[],
  options: BriefingOptions = {},
): ParsedContentStructure {
  // The preferred name first; a legend sheet last, so its rules are never read as page names.
  const rank = (name: string) => (PREFERRED_SHEET_RE.test(name.trim()) ? 0 : LEGEND_SHEET_RE.test(name) ? 2 : 1);
  const ordered = [...sheets].sort((a, b) => rank(a.name) - rank(b.name));
  let lastError: Error | null = null;
  for (const sheet of ordered) {
    try {
      return { ...parseContentStructureSheet(sheet.rows, options), sheet: sheet.name, legend: parseContentLegend(sheets, sheet.name) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `In der Datei wurde keine Seitenstruktur erkannt${lastError ? ` (${lastError.message})` : ""}. Erwartet: Spalten „URL, Startseite, Ebene 1, Ebene 2 (bei Bedarf Ebene 3 …), Traffic, Keywords, H1-Optionen, Nutzerfragen“ oder „Ebene 1 … n“.`,
  );
}

// --- the SEO structure tree ↔ briefing pages ----------------------------------------------------

/** Minimal tree shape of the SEO structure parser (`WebsiteStructureNode`), without importing it. */
export type StructureTreeNode = { label: string; path?: string; children: StructureTreeNode[] };

/**
 * Pages for a structure that came in as a tree (SEO → Struktur upload, markdown, sitemap …):
 * no briefing columns, roles from the tree. A top-level Startseite's children count as
 * top-level pages, so „Startseite → Silos“ and „Silos next to the Startseite“ read the same.
 */
export function briefingFromStructureTree(nodes: readonly StructureTreeNode[], options: BriefingOptions = {}): ContentBriefingPage[] {
  const raw: RawPage[] = [];
  const empty = { traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null };
  const walk = (list: readonly StructureTreeNode[], depth: number, underHome: boolean) => {
    for (const node of list) {
      if (raw.length >= CONTENT_STRUCTURE_MAX_PAGES) return;
      const name = node.label.trim() || node.path?.trim() || "Seite";
      const url = node.path?.trim() || null;
      const isHome = depth === 0 && !underHome && (url === "/" || /^(startseite|home)$/i.test(name));
      raw.push({ name, depth: isHome ? 0 : depth, isHome, url, ...empty });
      walk(node.children, isHome ? 0 : depth + 1, isHome || underHome);
    }
  };
  walk(nodes, 0, false);
  return buildPages(raw, options);
}

/**
 * The briefing pages as the indented tree the SEO parser reads (markdown bullets, paths
 * without origin), so SEO → Struktur shows the same pages Texte works with.
 */
export function briefingToStructureText(pages: readonly ContentBriefingPage[]): string {
  const lines: string[] = [];
  const hasHome = pages.some((p) => p.page_role === "startseite");
  for (const page of pages) {
    const depth = page.page_role === "startseite" ? 0 : page.page_role === "pillar" ? 1 : Math.max(2, page.level);
    const indent = hasHome ? depth : Math.max(0, depth - 1);
    const label = page.name.replace(/\s+/g, " ").trim();
    const path = page.path && page.path !== label ? ` ${page.path}` : "";
    lines.push(`${"  ".repeat(indent)}- ${label}${path}`);
  }
  return lines.join("\n");
}

/** Counts for the upload toast: how much briefing the sheet carried. */
export function summariseBriefing(pages: readonly ContentBriefingPage[]): {
  pages: number;
  keywords: number;
  questions: number;
  h1_options: number;
  skipped: number;
} {
  return {
    pages: pages.length,
    keywords: pages.filter((p) => p.keywords).length,
    questions: pages.filter((p) => p.user_questions.length > 0).length,
    h1_options: pages.filter((p) => p.h1_options.length > 0).length,
    skipped: pages.filter((p) => p.page_type === "nicht_bearbeiten").length,
  };
}
