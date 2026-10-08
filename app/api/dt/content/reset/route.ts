import { z } from "zod";

import { loadContentOverview } from "@/lib/dt/content/overview";
import { deleteContentPage, resetContentPage } from "@/lib/dt/content/pipeline/actions";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { loadContentPages } from "@/lib/dt/content/store";
import type { ContentResetResult } from "@/lib/dt/content/types";

export const maxDuration = 300;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  pages: z.array(z.string().refine(isValidContentSlug)).min(1).max(500),
  mode: z.enum(["reset", "delete"]).default("reset"),
});

/** „Auswahl zurücksetzen“ / „Auswahl löschen“ for the checked pages; running jobs are ended either way. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Bitte mindestens eine Seite auswählen.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  try {
    const pages = await loadContentPages(gate.service, gate.organisationId);
    const wanted = pages.filter((p) => parsed.data.pages.includes(p.slug));
    if (wanted.length === 0) return contentError("Keine passende Seite gefunden.", 404);

    const skipped: ContentResetResult["skipped"] = [];
    let affected = 0;
    for (const page of wanted) {
      const result =
        parsed.data.mode === "delete"
          ? await deleteContentPage(gate.service, page)
          : await resetContentPage(gate.service, page);
      if (result.ok) affected += 1;
      else skipped.push({ page: page.name, reason: result.message });
    }
    const overview = await loadContentOverview(gate.service, gate.organisationId);
    const data: ContentResetResult = { mode: parsed.data.mode, affected, skipped, overview };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seiten konnten nicht zurückgesetzt werden.", 500);
  }
}
