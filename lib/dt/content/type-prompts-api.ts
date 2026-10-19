/**
 * GET/PUT of a set of Textvorlagen, shared by the two routes that own one: Texte
 * (`/api/dt/content/type-prompts`, scope `texte`) and the SEO tool
 * (`/api/dt/text-tools/seo/type-prompts`, scope `seo_tool`). Same access (platform admins),
 * same validation, same answer; each route reads and writes only its own row.
 */

import { z } from "zod";

import { contentError, contentOk, gateContentAgencyRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import {
  CONTENT_TYPE_PROMPT_MAX_CHARS,
  DEFAULT_CONTENT_TYPE_PROMPTS,
  normalizeContentTypePrompts,
} from "@/lib/dt/content/type-prompts";
import {
  CONTENT_TYPE_PROMPTS_EXTRA_MIGRATION_FILE,
  CONTENT_TYPE_PROMPTS_HAUPTSEITE_MIGRATION_FILE,
  CONTENT_TYPE_PROMPTS_MIGRATION_FILE,
  loadContentTypePrompts,
  saveContentTypePrompts,
  type ContentTypePromptsScope,
  type ContentTypePromptsState,
} from "@/lib/dt/content/type-prompts-db";
import type { ContentTypePromptsResult } from "@/lib/dt/content/types";

const recipe = z.string().max(CONTENT_TYPE_PROMPT_MAX_CHARS).optional();

const putSchema = z.object({
  prompts: z
    .object({
      hauptsilo: recipe,
      hauptseite: recipe,
      unterseite: recipe,
      ratgeber: recipe,
      standort: recipe,
      startseite: recipe,
      ueber_uns: recipe,
    })
    .optional(),
  /** „Auf Standard zurücksetzen“: the defaults are stored, so the last change is visible. */
  reset: z.boolean().optional(),
});

function result(state: ContentTypePromptsState): ContentTypePromptsResult {
  return {
    prompts: state.prompts,
    defaults: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
    storage: state.storage,
    updated_at: state.updated_at,
    updated_by_email: state.updated_by_email,
    hint:
      state.storage === "missing_table"
        ? `Die Datenbank kennt die Textvorlagen noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin gelten die Standardvorlagen.`
        : state.storage === "missing_columns"
          ? `Die Datenbank kennt Startseite und Über-uns-Seite noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_EXTRA_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin lassen sich diese beiden Vorlagen nicht speichern.`
          : state.storage === "missing_hauptseite"
            ? `Die Datenbank kennt den Seitentyp Hauptseite noch nicht: Bitte ${CONTENT_TYPE_PROMPTS_HAUPTSEITE_MIGRATION_FILE} einmal im Supabase SQL Editor ausführen. Bis dahin gilt für die Hauptseite die Standardvorlage und die Textvorlagen lassen sich nicht speichern.`
            : null,
  };
}

/** One set of recipes. No organisation: one set for everyone with access. */
export async function getContentTypePromptsResponse(scope: ContentTypePromptsScope) {
  const gated = await gateContentAgencyRoute();
  if (!gated.ok) return gated.response;
  try {
    return contentOk(result(await loadContentTypePrompts(gated.gate.service, scope)));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Textvorlagen konnten nicht geladen werden.", 500);
  }
}

/** „Speichern“ / „Auf Standard zurücksetzen“. Empty recipes are never stored; the default takes their place. */
export async function putContentTypePromptsResponse(req: Request, scope: ContentTypePromptsScope) {
  const parsed = putSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError(`Ungültige Anfrage (max. ${CONTENT_TYPE_PROMPT_MAX_CHARS} Zeichen je Vorlage).`, 400);
  if (!parsed.data.reset && !parsed.data.prompts) return contentError("Keine Textvorlagen übermittelt.", 400);

  const gated = await gateContentAgencyRoute();
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const prompts = parsed.data.reset ? { ...DEFAULT_CONTENT_TYPE_PROMPTS } : normalizeContentTypePrompts(parsed.data.prompts);
  const saved = await saveContentTypePrompts(gate.service, { prompts, userId: gate.userId, userEmail: gate.userEmail }, scope);
  if (!saved.ok) return contentError(saved.error, 500);

  try {
    return contentOk(result(await loadContentTypePrompts(gate.service, scope)));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Textvorlagen konnten nicht geladen werden.", 500);
  }
}
