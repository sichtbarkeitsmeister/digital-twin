import { z } from "zod";

import { fillContactDataFromWebsite } from "@/lib/dt/contact-data-fill";
import { CONTACT_FIELD_LABELS } from "@/lib/dt/contact-data";
import { loadContentContactResult } from "@/lib/dt/content/contact-view";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import type { ContentContactActionResult } from "@/lib/dt/content/types";

/** Three live page fetches and at most one short extraction call. */
export const maxDuration = 120;

const bodySchema = z.object({ organisationId: z.string().uuid() });

/**
 * „Aus Website neu füllen“: reads Impressum, Kontakt and Startseite of the crawl again (live,
 * for the links) and fills the empty and crawl-filled fields. Manual values stay.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const fill = await fillContactDataFromWebsite(gate.service, gate.organisationId, {
      userId: gate.userId,
      note: "Kontaktdaten aus der Website neu gefüllt (Texte)",
    });
    if (!fill.ok) return contentError(fill.reason, 409);
    const result = await loadContentContactResult(gate.service, gate.organisationId);
    const data: ContentContactActionResult = {
      ...result,
      changed: fill.changed.map((key) => ({ key, source: "crawl" as const })),
      message:
        fill.changed.length > 0
          ? `Aus der Website übernommen: ${fill.changed.map((key) => CONTACT_FIELD_LABELS[key]).join(", ")}.`
          : "Nichts Neues auf der Website gefunden; manuelle Angaben bleiben, wie sie sind.",
    };
    return contentOk(data);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Kontaktdaten konnten nicht gefüllt werden.", 500);
  }
}
