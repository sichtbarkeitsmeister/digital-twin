/**
 * Zielgruppen je Seite (`dt_content_pages.zielgruppen`, migration 20261112): which of the
 * organisation's Zielgruppen avatars a page is written for. „Primär“ (one, at most two) sets the
 * address, examples and order; „Sekundär“ (up to three) is served along the way. The DigitalTwin
 * suggests them (`status: "vorschlag"`), the editor confirms or changes them (`"bestaetigt"`).
 * A page without any uses the organisation's Standard-Zielgruppe, as before.
 *
 * Pure and client-safe.
 */

export const CONTENT_ZIELGRUPPEN_MIGRATION_FILE = "database/migrations/20261112_dt_content_zielgruppen.sql";
export const CONTENT_PRIMARY_MAX = 2;
export const CONTENT_SECONDARY_MAX = 3;

export type ContentZielgruppenStatus = "vorschlag" | "bestaetigt";

export type ContentZielgruppen = {
  primary: string[];
  secondary: string[];
  status: ContentZielgruppenStatus;
  /** Why the DigitalTwin chose each one (by avatar id); kept after the editor confirms. */
  reasons: Record<string, string>;
  suggested_at: string | null;
  confirmed_at: string | null;
};

export const EMPTY_CONTENT_ZIELGRUPPEN: ContentZielgruppen = {
  primary: [],
  secondary: [],
  status: "vorschlag",
  reasons: {},
  suggested_at: null,
  confirmed_at: null,
};

/** The level of one avatar on a page, as the page window's switch shows it. */
export type ContentZielgruppeLevel = "primary" | "secondary" | "off";

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) if (typeof v === "string" && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  return out;
}

/**
 * The lists cleaned: no avatar twice, primary at most two, secondary at most three and never a
 * primary one; with `known` only ids of the organisation's Zielgruppen avatars.
 */
export function normalizeZielgruppenLists(
  primary: readonly string[],
  secondary: readonly string[],
  known?: ReadonlySet<string>,
): { primary: string[]; secondary: string[] } {
  const ok = (id: string) => !known || known.has(id);
  const p = ids(primary).filter(ok).slice(0, CONTENT_PRIMARY_MAX);
  const s = ids(secondary).filter((id) => ok(id) && !p.includes(id)).slice(0, CONTENT_SECONDARY_MAX);
  return { primary: p, secondary: s };
}

export function readContentZielgruppen(raw: unknown): ContentZielgruppen {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_CONTENT_ZIELGRUPPEN };
  const r = raw as Record<string, unknown>;
  const lists = normalizeZielgruppenLists(ids(r.primary), ids(r.secondary));
  const reasons: Record<string, string> = {};
  if (r.reasons && typeof r.reasons === "object" && !Array.isArray(r.reasons)) {
    for (const [id, text] of Object.entries(r.reasons as Record<string, unknown>)) {
      if (typeof text === "string" && text.trim()) reasons[id] = text.trim().slice(0, 400);
    }
  }
  return {
    ...lists,
    status: r.status === "bestaetigt" ? "bestaetigt" : "vorschlag",
    reasons,
    suggested_at: typeof r.suggested_at === "string" ? r.suggested_at : null,
    confirmed_at: typeof r.confirmed_at === "string" ? r.confirmed_at : null,
  };
}

/** Whether the page has its own Zielgruppen (else it runs with the Standard-Zielgruppe). */
export function hasContentZielgruppen(z: Pick<ContentZielgruppen, "primary">): boolean {
  return z.primary.length > 0;
}

export function zielgruppeLevel(z: Pick<ContentZielgruppen, "primary" | "secondary">, id: string): ContentZielgruppeLevel {
  if (z.primary.includes(id)) return "primary";
  if (z.secondary.includes(id)) return "secondary";
  return "off";
}

/**
 * One switch moved: the avatar's new level, the others as they were. A third primary pushes the
 * oldest primary down to secondary; the lists stay within their limits.
 */
export function withZielgruppeLevel(
  z: Pick<ContentZielgruppen, "primary" | "secondary">,
  id: string,
  level: ContentZielgruppeLevel,
): { primary: string[]; secondary: string[] } {
  let primary = z.primary.filter((x) => x !== id);
  let secondary = z.secondary.filter((x) => x !== id);
  if (level === "primary") {
    primary = [...primary, id];
    while (primary.length > CONTENT_PRIMARY_MAX) secondary = [...secondary, primary.shift()!];
  } else if (level === "secondary") {
    secondary = [...secondary, id];
  }
  return normalizeZielgruppenLists(primary, secondary.slice(-CONTENT_SECONDARY_MAX));
}
