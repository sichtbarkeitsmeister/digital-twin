import { z } from "zod";

import {
  CONTACT_CUSTOM_FIELDS_MAX,
  CONTACT_CUSTOM_LABEL_MAX,
  CONTACT_CUSTOM_VALUE_MAX,
  CONTACT_FIELD_KEYS,
  CONTACT_FIELD_MAX_CHARS,
} from "@/lib/dt/contact-data";
import { saveOrgContactData } from "@/lib/dt/contact-data-store";
import { loadContentContactResult } from "@/lib/dt/content/contact-view";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";

const fieldsSchema = z.object(
  Object.fromEntries(CONTACT_FIELD_KEYS.map((key) => [key, z.string().max(CONTACT_FIELD_MAX_CHARS[key] * 2).optional()])),
);

const putSchema = z.object({
  organisationId: z.string().uuid(),
  fields: fieldsSchema,
  custom: z
    .array(z.object({ label: z.string().max(CONTACT_CUSTOM_LABEL_MAX * 2), value: z.string().max(CONTACT_CUSTOM_VALUE_MAX * 2) }))
    .max(CONTACT_CUSTOM_FIELDS_MAX),
  no_google_profile: z.boolean(),
});

/** The Kontaktdaten card in Texte: the organisation's shared contact data (also in the Firmenprofil). */
export async function GET(req: Request) {
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  try {
    return contentOk(await loadContentContactResult(gated.gate.service, gated.gate.organisationId));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Kontaktdaten konnten nicht geladen werden.", 500);
  }
}

/**
 * „Speichern“: fields whose text changed become „manuell“ and are never overwritten by the
 * crawl or the web search. Firmenname, Website and Ansprechpartner go into the Firmenprofil;
 * every change into its change log.
 */
export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Kontaktdaten.", 400);
  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    await saveOrgContactData(gate.service, {
      organisationId: gate.organisationId,
      userId: gate.userId,
      values: {
        fields: parsed.data.fields as Record<string, string>,
        custom: parsed.data.custom,
        no_google_profile: parsed.data.no_google_profile,
      },
      note: "Kontaktdaten in Texte geändert",
    });
    return contentOk(await loadContentContactResult(gate.service, gate.organisationId));
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Kontaktdaten konnten nicht gespeichert werden.", 500);
  }
}
