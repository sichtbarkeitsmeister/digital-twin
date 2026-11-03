import { z } from "zod";

import { searchGoogleProfile } from "@/lib/dt/contact-data-fill";
import { GOOGLE_NOT_FOUND_HINT } from "@/lib/dt/contact-data";
import { loadContentContactResult } from "@/lib/dt/content/contact-view";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import type { ContentContactActionResult } from "@/lib/dt/content/types";

/** One web search turn: at most 3 searches and 2 fetches. */
export const maxDuration = 120;

const bodySchema = z.object({ organisationId: z.string().uuid() });

/** „Google-Profil suchen“: the web search again, on request (the automatic one runs once per organisation). */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const outcome = await searchGoogleProfile(gate.service, gate.organisationId, { userId: gate.userId, force: true });
    if (!outcome.ok) return contentError(outcome.reason, 409);
    const result = await loadContentContactResult(gate.service, gate.organisationId);
    const found = outcome.search.status === "found";
    const data: ContentContactActionResult = {
      ...result,
      changed: found ? [{ key: "google_profil", source: "websuche" }] : [],
      message: found
        ? "Google-Profil per Websuche gefunden – bitte prüfen."
        : outcome.search.status === "error"
          ? `Die Websuche ist fehlgeschlagen: ${outcome.search.reason ?? "unbekannter Fehler"}`
          : `${GOOGLE_NOT_FOUND_HINT}${outcome.search.reason && outcome.search.status === "rejected" ? ` (${outcome.search.reason})` : ""}`,
    };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Die Suche ist fehlgeschlagen.", 500);
  }
}
