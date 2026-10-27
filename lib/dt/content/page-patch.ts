/**
 * The body of `PATCH /api/dt/content/pages/[slug]`: the Seitentyp and/or the steps switched
 * off for the page („Schritte“ in the page window). Kept out of the route file (Next allows
 * only handlers there) so the validation is testable.
 */

import { z } from "zod";

import { CONTENT_PAGE_TYPES } from "@/lib/dt/content/page-types";
import {
  CONTENT_SKIPPABLE_STEP_KEYS,
  contentStepByKey,
  contentStepSkippable,
  isContentSkippableStepKey,
} from "@/lib/dt/content/pipeline/steps";

const patchSchema = z
  .object({
    organisationId: z.string().uuid(),
    page_type: z.enum(CONTENT_PAGE_TYPES).optional(),
    /** The whole new list; each switch sends it. Duplicates are dropped when it is stored. */
    skip_steps: z.array(z.enum(CONTENT_SKIPPABLE_STEP_KEYS)).max(CONTENT_SKIPPABLE_STEP_KEYS.length * 2).optional(),
  })
  .refine((body) => body.page_type !== undefined || body.skip_steps !== undefined);

export type ContentPagePatchBody = z.infer<typeof patchSchema>;

/** Why a `skip_steps` entry is refused before the page is even loaded: Analyse, Endabnahme, unknown keys. */
function skipStepsMessage(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : null;
  if (!list) return "Ungültige Liste der abgeschalteten Schritte.";
  const wrong = list.find((key) => !isContentSkippableStepKey(key));
  if (wrong === undefined) return "Ungültige Liste der abgeschalteten Schritte.";
  const key = String(wrong);
  const def = contentStepByKey(key);
  const check = contentStepSkippable({ source: "crawl", source_url: "x" }, key);
  if (def && !check.ok) return `„${def.name}“ lässt sich nicht abschalten. ${check.reason}`;
  return `Unbekannter Schritt „${key.slice(0, 40)}“.`;
}

export function parseContentPagePatch(
  body: unknown,
): { ok: true; data: ContentPagePatchBody } | { ok: false; message: string } {
  const parsed = patchSchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if ("skip_steps" in raw && !z.array(z.enum(CONTENT_SKIPPABLE_STEP_KEYS)).safeParse(raw.skip_steps).success) {
    return { ok: false, message: skipStepsMessage(raw.skip_steps) };
  }
  if ("page_type" in raw) return { ok: false, message: "Ungültiger Seitentyp." };
  return { ok: false, message: "Ungültige Anfrage." };
}
