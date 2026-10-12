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
 *      Ebene-1 row above it. Extra columns „KI-Prompt / Prompt / Content-Prompt“ are read
 *      when their header exists. Without a header the columns are taken by position.
 *   2. The DigitalTwin template „Ebene 1 … n“ (+ optional URL), plus the briefing columns
 *      F/G/H when their headers exist. Depth 0 is a Hauptsilo (or the Startseite), deeper
 *      rows are Unterseiten of the nearest depth-0 row.
 *
 * Nothing is invented: a missing cell stays empty, a keyword without volume has none.
 * The SEO parser (`lib/dt/seo/website-structure*.ts`) is not used here; SEO → Struktur keeps
 * its own name/path flattening. `briefingToStructureText` renders the same pages as an
 * indented tree so that parser can store an outline that matches the Texte table.
 */

import {
  derivePageType,
  type ContentPageRole,
  type ContentPageType,
} from "@/lib/dt/content/page-types";
import { slugify } from "@/lib/dt/content/render";
import type { SheetCell, SheetRows } from "@/lib/dt/seo/website-structure-xlsx";

export type ContentKeyword = { text: string; volume?: number };
export type ContentPageKeywords = { main: ContentKeyword; secondary: ContentKeyword[] };

/** One page as the Excel briefs it; the store writes it onto `dt_content_pages`. */
export type ContentBriefingPage = {
  slug: string;
  name: string;
  path: string | null;
  /** 0 Startseite, 1 Hauptsilo, 2 Unterseite (3 for a third Excel level). */
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
    if (!raw) continue;
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

type Header = {
  rowIndex: number;
  url: number;
  startseite: number;
  l1: number;
  l2: number;
  /** Template layout: one column per depth. */
  levels: number[];
  traffic: number;
  keywords: number;
  h1: number;
  questions: number;
  prompt: number;
};

function emptyHeader(rowIndex: number): Header {
  return { rowIndex, url: -1, startseite: -1, l1: -1, l2: -1, levels: [], traffic: -1, keywords: -1, h1: -1, questions: -1, prompt: -1 };
}

type HeaderLayout = { header: Header; layout: ParsedContentStructure["layout"] };

/**
 * Which row is the header and which layout it announces. A „Startseite“ column makes it the
 * old briefing (its level columns are Ebene 1 and Ebene 2); two or more level columns without
 * one make it the DT template; a single name column next to a URL column is a flat list.
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
      else if (H_PROMPT.test(c) && header.prompt < 0) header.prompt = col;
    });
    const sorted = levelCols.sort((a, b) => a.n - b.n);
    header.levels = sorted.map((l) => l.col);
    if (header.l1 < 0) header.l1 = sorted.find((l) => l.n === 1)?.col ?? -1;
    if (header.l2 < 0) header.l2 = sorted.find((l) => l.n === 2)?.col ?? -1;

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
    ki_prompt: header.prompt >= 0 ? at(row, header.prompt).trim() || null : null,
  };
}

/** Layout 1: the name sits in Startseite, Ebene 1 or Ebene 2. */
function rawPagesFromBriefingColumns(rows: string[][], header: Header): RawPage[] {
  const out: RawPage[] = [];
  for (const row of rows) {
    const home = at(row, header.startseite);
    const l1 = at(row, header.l1);
    const l2 = at(row, header.l2);
    const url = isUrlCell(at(row, header.url)) ? at(row, header.url) : null;
    let name = "";
    let depth = 0;
    let isHome = false;
    if (home) {
      // The Startseite column holds the home page's name, a marker („x“, „ja“) or its URL.
      isHome = true;
      const marker = /^(x|ja|yes|✓|✔)$/i.test(home) || isUrlCell(home);
      name = marker ? (!isUrlCell(l1) && l1) || (!isUrlCell(l2) && l2) || "Startseite" : home;
    } else if (l1 && !isUrlCell(l1)) {
      name = l1;
      depth = 0;
    } else if (l2 && !isUrlCell(l2)) {
      name = l2;
      depth = 1;
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

/**
 * No header. URLs in column A: the old briefing, columns A–H by position as the importer
 * read them. Otherwise the DT template without its header row: the column is the depth.
 */
function rawPagesByPosition(rows: string[][]): { raw: RawPage[]; layout: ParsedContentStructure["layout"] } {
  const urlsInFirstColumn = rows.some((row) => isUrlCell(row[0] ?? ""));
  if (urlsInFirstColumn) {
    const header: Header = { ...emptyHeader(-1), url: 0, startseite: 1, l1: 2, l2: 3, traffic: 4, keywords: 5, h1: 6, questions: 7 };
    return { raw: rawPagesFromBriefingColumns(rows, header), layout: "briefing" };
  }
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
): Omit<ParsedContentStructure, "sheet"> {
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

/** The sheet „Webseitenstruktur“ first, else the first sheet that yields pages. */
export function parseContentStructureWorkbook(
  sheets: readonly SheetInput[],
  options: BriefingOptions = {},
): ParsedContentStructure {
  const ordered = [...sheets].sort((a, b) => Number(PREFERRED_SHEET_RE.test(b.name.trim())) - Number(PREFERRED_SHEET_RE.test(a.name.trim())));
  let lastError: Error | null = null;
  for (const sheet of ordered) {
    try {
      return { ...parseContentStructureSheet(sheet.rows, options), sheet: sheet.name };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `In der Datei wurde keine Seitenstruktur erkannt${lastError ? ` (${lastError.message})` : ""}. Erwartet: Spalten „URL, Startseite, Ebene 1, Ebene 2, Traffic, Keywords, H1-Optionen, Nutzerfragen“ oder „Ebene 1 … n“.`,
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
