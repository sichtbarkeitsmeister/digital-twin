/**
 * The internal link targets a page may use ([LINK: Seitenname] markers) when the Seitenstruktur
 * (Excel) did not name any: pages taken over from the crawl, or an Excel row without Hauptsilo. Without
 * targets the text steps may not set a single internal link and the Faktencheck then flags
 * „Keine internen Links möglich“. The targets come from the table of pages itself: the Startseite,
 * the page's Hauptsilo, its Unterseiten and siblings, pages in the same path and pages with a
 * similar keyword. Pure.
 */

import { effectiveContentPageType } from "@/lib/dt/content/page-types";
import type { ContentOutlinePage } from "@/lib/dt/content/store";

/** Enough for natural links in one text; the model links only where it fits. */
export const DERIVED_LINK_TARGETS_MAX = 12;

type LinkPage = Pick<ContentOutlinePage, "slug" | "name" | "path" | "level" | "pillar_name" | "page_role" | "page_type" | "main_keyword" | "keywords">;

const segments = (path: string | null | undefined): string[] => (path ?? "").split(/[?#]/)[0]!.split("/").map((s) => s.trim().toLowerCase()).filter(Boolean);
const tokens = (text: string | null | undefined): Set<string> =>
  new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((t) => t.length > 3),
  );
const mainKeyword = (p: Pick<LinkPage, "keywords" | "main_keyword">) => p.keywords?.main.text ?? p.main_keyword;

function isStart(p: LinkPage): boolean {
  return p.page_role === "startseite" || p.level === 0 || segments(p.path).length === 0;
}

/** How well `other` suits as a link target of `page`; higher is better, 0 still possible. */
function score(page: LinkPage, other: LinkPage): number {
  let s = 0;
  if (isStart(other)) s += 100;
  if (page.pillar_name && other.name === page.pillar_name) s += 90;
  if (other.pillar_name && other.pillar_name === page.name) s += 80;
  if (page.pillar_name && other.pillar_name === page.pillar_name) s += 60;
  const a = segments(page.path);
  const b = segments(other.path);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  if (shared > 0 && shared === b.length && b.length < a.length) s += 70; // its parent in the path
  s += 20 * Math.min(shared, 3);
  const own = tokens(mainKeyword(page));
  const overlap = [...tokens(mainKeyword(other))].filter((t) => own.has(t)).length;
  s += Math.min(30, overlap * 10);
  return s;
}

/**
 * Up to `DERIVED_LINK_TARGETS_MAX` names of other pages of the table, the best fitting first. Pages
 * that get no text (Impressum, Datenschutz …) are no targets. Empty only when there is no other page.
 */
export function deriveInternalLinkTargets(page: LinkPage, outline: readonly LinkPage[], max: number = DERIVED_LINK_TARGETS_MAX): string[] {
  const candidates = outline.filter(
    (o) => o.slug !== page.slug && o.name.trim() && effectiveContentPageType({ page_type: o.page_type, page_role: o.page_role, level: o.level, name: o.name, path: o.path }) !== "nicht_bearbeiten",
  );
  const ranked = candidates.map((o) => ({ name: o.name, score: score(page, o) })).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "de"));
  return [...new Set(ranked.map((r) => r.name))].filter((n) => n !== page.name).slice(0, max);
}

/** More Standortseiten than this are not listed as link targets of one overview. */
export const STANDORT_LINK_TARGETS_MAX = 60;

/**
 * The link targets of a „Hauptsilo Standort-Übersicht“: its recipe links every Standortseite, so
 * every page of the table with the type Standortseite is an allowed target, also one the
 * Seitenstruktur did not put under this page. The Standortseiten go first (table order), then
 * `targets` as they were. Any other page type gets `targets` back unchanged.
 */
export function withStandortLinkTargets(
  page: Pick<LinkPage, "slug" | "name"> & { page_type: LinkPage["page_type"] },
  targets: readonly string[],
  outline: readonly LinkPage[],
): string[] {
  if (page.page_type !== "hauptsilo_standort") return [...targets];
  const standorte = outline
    .filter((o) => o.slug !== page.slug && o.name.trim() && o.name !== page.name)
    .filter((o) => effectiveContentPageType({ page_type: o.page_type, page_role: o.page_role, level: o.level, name: o.name, path: o.path }) === "standort")
    .map((o) => o.name)
    .slice(0, STANDORT_LINK_TARGETS_MAX);
  return [...new Set([...standorte, ...targets])];
}
