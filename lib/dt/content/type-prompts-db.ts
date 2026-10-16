/**
 * Reads and writes the agency's writing recipes (`dt_content_type_prompts`). Always called
 * with the service client: the route checks access first, the job runner has none. A missing
 * table (migration not run) answers with the defaults so a page run never fails because of it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingContentColumnError, isMissingContentTableError } from "@/lib/dt/content/store";
import {
  DEFAULT_CONTENT_TYPE_PROMPTS,
  normalizeContentTypePrompts,
  type ContentTypePrompts,
} from "@/lib/dt/content/type-prompts";

export const CONTENT_TYPE_PROMPTS_MIGRATION_FILE = "database/migrations/20261010_dt_content_type_prompts.sql";
/** Adds the Startseite and Über-uns-Seite columns, and allows those page types on `dt_content_pages`. */
export const CONTENT_TYPE_PROMPTS_EXTRA_MIGRATION_FILE = "database/migrations/20261015_dt_content_startseite_ueber_uns.sql";
/** Adds the Hauptseite column, and allows that page type on `dt_content_pages`. */
export const CONTENT_TYPE_PROMPTS_HAUPTSEITE_MIGRATION_FILE = "database/migrations/20261017_dt_content_hauptseite.sql";

const ROW_ID = "agency";
const COLUMNS = "hauptsilo, hauptseite, unterseite, ratgeber, standort, startseite, ueber_uns, updated_at, updated_by_email";
/** Before 20261017: everything but the Hauptseite. */
const WITHOUT_HAUPTSEITE_COLUMNS = "hauptsilo, unterseite, ratgeber, standort, startseite, ueber_uns, updated_at, updated_by_email";
const LEGACY_COLUMNS = "hauptsilo, unterseite, ratgeber, standort, updated_at, updated_by_email";

export type ContentTypePromptsState = {
  prompts: ContentTypePrompts;
  /**
   * Where the recipes come from: the saved row, the defaults (no row yet), or the defaults
   * because the table or some columns are missing (`missing_hauptseite`: only 20261017).
   */
  storage: "db" | "defaults" | "missing_table" | "missing_columns" | "missing_hauptseite";
  updated_at: string | null;
  updated_by_email: string | null;
};

function stateFromRow(
  data: Record<string, unknown> | null,
  storage: ContentTypePromptsState["storage"],
): ContentTypePromptsState {
  if (!data) {
    return { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS }, storage: storage === "db" ? "defaults" : storage, updated_at: null, updated_by_email: null };
  }
  return {
    prompts: normalizeContentTypePrompts(data),
    storage,
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
    updated_by_email: typeof data.updated_by_email === "string" && data.updated_by_email ? data.updated_by_email : null,
  };
}

export async function loadContentTypePrompts(service: SupabaseClient): Promise<ContentTypePromptsState> {
  const { data, error } = await service.from("dt_content_type_prompts").select(COLUMNS).eq("id", ROW_ID).maybeSingle();
  if (error) {
    if (isMissingContentTableError(error)) {
      return { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS }, storage: "missing_table", updated_at: null, updated_by_email: null };
    }
    if (isMissingContentColumnError(error)) {
      // Only the Hauptseite column missing: keep the saved Startseite and Über-uns recipes.
      const recent = await service.from("dt_content_type_prompts").select(WITHOUT_HAUPTSEITE_COLUMNS).eq("id", ROW_ID).maybeSingle();
      if (!recent.error) return stateFromRow((recent.data as Record<string, unknown> | null) ?? null, "missing_hauptseite");
      const legacy = await service.from("dt_content_type_prompts").select(LEGACY_COLUMNS).eq("id", ROW_ID).maybeSingle();
      if (legacy.error) {
        if (isMissingContentTableError(legacy.error)) {
          return { prompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS }, storage: "missing_table", updated_at: null, updated_by_email: null };
        }
        throw new Error(`Textvorlagen konnten nicht geladen werden: ${legacy.error.message}`);
      }
      return stateFromRow((legacy.data as Record<string, unknown> | null) ?? null, "missing_columns");
    }
    throw new Error(`Textvorlagen konnten nicht geladen werden: ${error.message}`);
  }
  return stateFromRow((data as Record<string, unknown> | null) ?? null, "db");
}

/** The recipes for a page run; any read problem means the defaults, never a failed step. */
export async function loadContentTypePromptsForRun(service: SupabaseClient): Promise<ContentTypePrompts> {
  try {
    return (await loadContentTypePrompts(service)).prompts;
  } catch (error) {
    console.warn("[content] type prompts not readable, defaults used:", error instanceof Error ? error.message : error);
    return { ...DEFAULT_CONTENT_TYPE_PROMPTS };
  }
}

export async function saveContentTypePrompts(
  service: SupabaseClient,
  input: { prompts: ContentTypePrompts; userId: string; userEmail: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeContentTypePrompts(input.prompts);
  const { error } = await service.from("dt_content_type_prompts").upsert(
    {
      id: ROW_ID,
      ...clean,
      updated_by: input.userId,
      updated_by_email: input.userEmail,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (!error) return { ok: true };
  if (isMissingContentColumnError(error)) {
    return {
      ok: false,
      error: /hauptseite/i.test(error.message ?? "")
        ? `Die Datenbank kennt den Seitentyp Hauptseite noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_HAUPTSEITE_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`
        : `Die Datenbank kennt Startseite und Über-uns-Seite noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_EXTRA_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`,
    };
  }
  if (isMissingContentTableError(error)) {
    return {
      ok: false,
      error: `Die Datenbank kennt die Textvorlagen noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen.`,
    };
  }
  return { ok: false, error: `Textvorlagen konnten nicht gespeichert werden: ${error.message}` };
}
