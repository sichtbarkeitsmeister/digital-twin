import { slugify } from "@/lib/dt/content/render";

/** Same cap as the structure sync (`MAX_PAGES` in the store). */
export const MANUAL_PAGE_LIMIT = 300;

export type ManualPageDraft = {
  name: string;
  keyword?: string | null;
};

export type PlannedManualPage = {
  slug: string;
  name: string;
  main_keyword: string | null;
  level: number;
  position: number;
};

/** One page per line: `Name` or `Name | keyword`. Blank lines and blank names are dropped. */
export function parseManualPageLines(text: string): ManualPageDraft[] {
  const out: ManualPageDraft[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const pipe = line.indexOf("|");
    const name = (pipe === -1 ? line : line.slice(0, pipe)).trim();
    if (!name) continue;
    const keyword = pipe === -1 ? "" : line.slice(pipe + 1).trim();
    out.push(keyword ? { name, keyword } : { name });
    if (out.length >= MANUAL_PAGE_LIMIT) break;
  }
  return out;
}

/**
 * New page rows for a typed list. A name whose slug already exists in the organisation is
 * skipped, so saving the same list again does not duplicate and does not touch stored text.
 * Two identical names in one list get `slug` and `slug-2`, same as the structure flattener.
 * Level is always 1. Positions continue after the current maximum.
 */
export function planManualContentPages(
  existing: readonly { slug: string; position?: number | null }[],
  pages: readonly ManualPageDraft[],
): PlannedManualPage[] {
  const existingSlugs = new Set(existing.map((row) => row.slug));
  const used = new Set(existingSlugs);
  let nextPosition = existing.reduce((max, row) => Math.max(max, row.position ?? -1), -1) + 1;
  const room = Math.max(0, MANUAL_PAGE_LIMIT - existing.length);
  const planned: PlannedManualPage[] = [];

  for (const page of pages) {
    if (planned.length >= room) break;
    const name = page.name.trim();
    if (!name) continue;
    const base = slugify(name) || "seite";
    if (existingSlugs.has(base)) continue;
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    const keyword = page.keyword?.trim() || null;
    planned.push({
      slug,
      name,
      main_keyword: keyword,
      level: 1,
      position: nextPosition++,
    });
  }
  return planned;
}
