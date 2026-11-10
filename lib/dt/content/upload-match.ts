/**
 * „Verbesserung → Texte hochladen“: Word files (file name = page name) matched to the pages of
 * the Seitenstruktur. Pure and deterministic, no model anywhere: a file belongs to a page only
 * when their names give the same `pageNameKey`. Everything else is assigned by hand, and a
 * manual decision always wins over the automatic match.
 *
 * Also the plan of „Zugeordnete Seiten übernehmen“ (`planUploadTakeover`): which assigned file
 * is attached to an existing row of the Texte table and which creates a new one.
 */

import type { ContentBriefingPage } from "@/lib/dt/content/excel-structure";
import { htmlToMarkdown, type ContentTextBlock } from "@/lib/dt/content/render";
import { matchStructureRows, type StructurePlanRow } from "@/lib/dt/content/structure-plan";

/**
 * The name a file and a page are compared by. The same function runs on both sides, so
 * „Über uns“ and „ueber_uns.docx“ meet. In this order:
 *   1. Unicode NFC
 *   2. a trailing „.docx“ goes
 *   3. lower case (de-DE)
 *   4. ä → ae, ö → oe, ü → ue, ß → ss
 *   5. every character a file name may not contain (/ \ : * ? " < > |) becomes a space
 *   6. _ and - become spaces
 *   7. whitespace collapses; spaces at both ends and trailing dots go
 * Nothing else: no fuzzy comparison, no „(1)“ or „Kopie“ handling.
 */
export function pageNameKey(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\.docx$/i, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[ .]+$/, "")
    .trim();
}

/**
 * One Word file per request, so a batch never meets the request body limit of the host
 * (Vercel: about 4.5 MB). A text-only .docx of a web page is a few dozen KB; 4 MB leaves room
 * for embedded pictures.
 */
export const TEXT_UPLOAD_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** How many files the browser sends at the same time. */
export const TEXT_UPLOAD_PARALLEL = 3;
/** .doc is offered so the old format gets the ingest's message instead of being unselectable. */
export const TEXT_UPLOAD_ACCEPT = ".docx,.doc";

/** How a file got its page: by the name rule, by hand (also: taken off a page by hand), or not yet decided. */
export type TextUploadMatch = "auto" | "manual" | null;

export type TextUploadStatus =
  /** „automatisch zugeordnet“ */
  | "auto"
  /** „manuell zugeordnet“ */
  | "manual"
  /** „nicht zugeordnet“ */
  | "unassigned"
  /** „mehrdeutig“: several pages of the Seitenstruktur have this name */
  | "ambiguous"
  /** „doppelt“: another file already stands for this name or this page */
  | "duplicate"
  /** „wartet auf Seitenstruktur“ */
  | "waiting"
  /** „Fehler: …“: the file could not be read */
  | "error";

export const UPLOAD_PAGE_GONE_NOTE = "Seite nicht mehr in der Seitenstruktur";
export const UPLOAD_UNASSIGNED_BY_HAND_NOTE = "Zuordnung von Hand gelöst";

export type UploadMatchFile = {
  id: string;
  file_name: string;
  name_key: string;
  structure_slug: string | null;
  match: TextUploadMatch;
  match_note: string | null;
  /** Set when the file could not be read: it is never assigned. */
  error?: string | null;
};

export type UploadMatchPage = Pick<ContentBriefingPage, "slug" | "name" | "path">;

export type UploadMatchResult = {
  id: string;
  structure_slug: string | null;
  match: TextUploadMatch;
  match_note: string | null;
  status: TextUploadStatus;
};

function pageLabel(page: UploadMatchPage): string {
  return page.path ? `„${page.name}“ (${page.path})` : `„${page.name}“`;
}

/**
 * Files (in upload order) against the pages of the Seitenstruktur; `pages` is null while no
 * Seitenstruktur is uploaded. A page has at most one file.
 *
 * Manual decisions first, and they are never re-matched: an assignment stays as long as its
 * page is in the Seitenstruktur (otherwise the file is „nicht zugeordnet“ with a note and waits
 * for a new decision by hand), and a file taken off its page by hand stays off.
 *
 * Every other readable file is matched by `pageNameKey`:
 *   - exactly one page with the key → assigned („auto“);
 *   - no page → „nicht zugeordnet“;
 *   - several pages with the key → „mehrdeutig“, not assigned, the note names the pages;
 *   - a second file with the same key → „doppelt“, not assigned (the first one has the page);
 *   - the page already has a file assigned by hand → „doppelt“, not assigned.
 */
export function matchTextUploads(
  files: readonly UploadMatchFile[],
  pages: readonly UploadMatchPage[] | null,
): UploadMatchResult[] {
  const bySlug = new Map((pages ?? []).map((p) => [p.slug, p]));
  const byKey = new Map<string, UploadMatchPage[]>();
  for (const page of pages ?? []) {
    const key = pageNameKey(page.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), page]);
  }

  const results = new Map<string, UploadMatchResult>();
  /** Page slug → the file that has it. */
  const taken = new Map<string, UploadMatchFile>();

  for (const file of files) {
    if (file.error) {
      results.set(file.id, { id: file.id, structure_slug: null, match: null, match_note: null, status: "error" });
      continue;
    }
    if (file.match !== "manual") continue;
    const unassigned = (note: string | null): UploadMatchResult => ({
      id: file.id,
      structure_slug: null,
      match: "manual",
      match_note: note,
      status: "unassigned",
    });
    if (!file.structure_slug) {
      results.set(file.id, unassigned(file.match_note ?? UPLOAD_UNASSIGNED_BY_HAND_NOTE));
    } else if (!bySlug.has(file.structure_slug)) {
      results.set(file.id, unassigned(UPLOAD_PAGE_GONE_NOTE));
    } else if (taken.has(file.structure_slug)) {
      const other = taken.get(file.structure_slug)!;
      results.set(file.id, {
        ...unassigned(`Die Seite ${pageLabel(bySlug.get(file.structure_slug)!)} hat bereits die Datei „${other.file_name}“`),
        status: "duplicate",
      });
    } else {
      taken.set(file.structure_slug, file);
      results.set(file.id, { id: file.id, structure_slug: file.structure_slug, match: "manual", match_note: null, status: "manual" });
    }
  }

  /** Name key → the first automatic file with it. */
  const firstByKey = new Map<string, UploadMatchFile>();
  for (const file of files) {
    if (results.has(file.id)) continue;
    const open = (status: TextUploadStatus, note: string | null = null): UploadMatchResult => ({
      id: file.id,
      structure_slug: null,
      match: null,
      match_note: note,
      status,
    });
    if (!pages) {
      results.set(file.id, open("waiting"));
      continue;
    }
    const key = file.name_key;
    const first = key ? firstByKey.get(key) : undefined;
    if (first) {
      results.set(file.id, open("duplicate", `Gleicher Seitenname wie die Datei „${first.file_name}“`));
      continue;
    }
    if (key) firstByKey.set(key, file);
    const candidates = key ? (byKey.get(key) ?? []) : [];
    if (candidates.length === 0) {
      results.set(file.id, open("unassigned"));
    } else if (candidates.length > 1) {
      results.set(file.id, open("ambiguous", `Mehrere Seiten der Seitenstruktur heißen so: ${candidates.map(pageLabel).join(", ")}`));
    } else {
      const page = candidates[0]!;
      const holder = taken.get(page.slug);
      if (holder) {
        results.set(file.id, open("duplicate", `Die Seite ${pageLabel(page)} hat bereits die Datei „${holder.file_name}“`));
      } else {
        taken.set(page.slug, file);
        results.set(file.id, { id: file.id, structure_slug: page.slug, match: "auto", match_note: null, status: "auto" });
      }
    }
  }

  return files.map((file) => results.get(file.id)!);
}

export const TEXT_UPLOAD_STATUS_LABELS: Record<TextUploadStatus, string> = {
  auto: "automatisch zugeordnet",
  manual: "manuell zugeordnet",
  unassigned: "nicht zugeordnet",
  ambiguous: "mehrdeutig",
  duplicate: "doppelt",
  waiting: "wartet auf Seitenstruktur",
  error: "Fehler",
};

// --- „Zugeordnete Seiten übernehmen“ ----------------------------------------------------------

/** What the takeover needs of a row of `dt_content_pages`. */
export type TakeoverRow = StructurePlanRow & { id: string; state: string };

export type TakeoverUpload = {
  id: string;
  file_name: string;
  structure_slug: string | null;
  /** The row the file is linked to already. */
  page_id: string | null;
  error?: string | null;
};

export type UploadTakeoverPlan = {
  /** Existing rows that get the file. `started`: the row keeps its state and text; the file counts from the next run. */
  attach: Array<{ upload_id: string; file_name: string; row_id: string; row_slug: string; started: boolean }>;
  /** Pages of the Seitenstruktur that become new rows (slug unique against the table). */
  create: Array<{ upload_id: string; file_name: string; page: ContentBriefingPage }>;
  /** Files whose row has them already. */
  already: number;
  /** Assigned files that would need a new row beyond the page limit. */
  over_limit: number;
  skipped: Array<{ file: string; reason: string }>;
};

export const UPLOAD_TAKEOVER_RUNNING_REASON = "Die Seite läuft gerade – nach dem Lauf erneut übernehmen.";

/**
 * Every assigned, readable file: its page of the Seitenstruktur is looked up in the table with
 * the rules of „Verbesserung“ (`matchStructureRows`: path first, then slug). A row that exists
 * gets the file attached — never while it runs, and a started row keeps its state and text. No
 * row: the page is created from the Seitenstruktur, also a „Nicht bearbeiten“ page (it keeps
 * that type), as long as the table stays within `limit` rows.
 */
export function planUploadTakeover(
  uploads: readonly TakeoverUpload[],
  pages: readonly ContentBriefingPage[],
  rows: readonly TakeoverRow[],
  limit: number,
): UploadTakeoverPlan {
  const plan: UploadTakeoverPlan = { attach: [], create: [], already: 0, over_limit: 0, skipped: [] };
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));
  const rowBySlug = new Map(rows.map((r) => [r.slug, r]));
  const rowOfPage = matchStructureRows(pages, rows);
  const used = new Set(rows.map((r) => r.slug));
  let total = rows.length;

  for (const upload of uploads) {
    if (upload.error || !upload.structure_slug) continue;
    const page = pageBySlug.get(upload.structure_slug);
    if (!page) continue;
    const rowSlug = rowOfPage.get(page.slug);
    const row = rowSlug ? rowBySlug.get(rowSlug) : undefined;
    if (row) {
      if (upload.page_id === row.id) {
        plan.already += 1;
      } else if (row.state === "laeuft") {
        plan.skipped.push({ file: upload.file_name, reason: UPLOAD_TAKEOVER_RUNNING_REASON });
      } else {
        plan.attach.push({
          upload_id: upload.id,
          file_name: upload.file_name,
          row_id: row.id,
          row_slug: row.slug,
          started: row.state !== "nicht_begonnen",
        });
      }
      continue;
    }
    if (total >= limit) {
      plan.over_limit += 1;
      continue;
    }
    let slug = page.slug;
    let n = 2;
    while (used.has(slug)) slug = `${page.slug}-${n++}`;
    used.add(slug);
    total += 1;
    plan.create.push({ upload_id: upload.id, file_name: upload.file_name, page: { ...page, slug, source_url: null } });
  }
  return plan;
}

// --- the text of an upload as the prompts read it ----------------------------------------------

/** The sections of a Word file as Markdown: headings as `#` lines, lists and emphasis kept. */
export function uploadBlocksToMarkdown(blocks: readonly ContentTextBlock[]): string {
  return blocks
    .map((b) => {
      const heading = b.heading ? `${"#".repeat(b.level)} ${b.heading}` : "";
      return [heading, htmlToMarkdown(b.html)].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
