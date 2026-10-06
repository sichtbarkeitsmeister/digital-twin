import { z } from "zod";

import {
  loadContentAvatarOptions,
  loadContentAvatarRow,
  loadContentWorkshopAnbieter,
} from "@/lib/dt/content/load-sources";
import {
  CONTENT_ANREDEN,
  CONTENT_BRANCHEN,
  CONTENT_TONALITAET_KEYS,
  anbieterFromWorkshop,
  avatarFromAgent,
  filledWorkshopSections,
  mergeContentAnbieter,
} from "@/lib/dt/content/mapping";
import { contentError, contentOk, gateContentRoute, readJsonBody } from "@/lib/dt/content/route-helpers";
import { saveContentSettings } from "@/lib/dt/content/store";
import type { ContentClientPutBody, ContentClientPutResult } from "@/lib/dt/content/types";

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  agentId: z.string().uuid().nullable().optional(),
  settings: z.object({
    anrede: z.enum(CONTENT_ANREDEN),
    branche: z.enum(CONTENT_BRANCHEN),
    tonalitaet: z.enum(CONTENT_TONALITAET_KEYS),
    verbotene_woerter: z.array(z.string().max(200)).max(100),
  }),
});

/**
 * Saves the confirmed text settings and the chosen avatar (`dt_content_settings`) and
 * returns what the pipeline will work with (workshop facts + settings + avatar).
 */
export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const [{ data: organisation }, sections, { data: structure }] = await Promise.all([
    gate.service.from("organisations").select("name").eq("id", gate.organisationId).maybeSingle(),
    loadContentWorkshopAnbieter(gate.service, gate.organisationId).catch(() => []),
    gate.service
      .from("dt_website_structures")
      .select("filename")
      .eq("organisation_id", gate.organisationId)
      .maybeSingle(),
  ]);

  let agentId = parsed.data.agentId ?? null;
  if (!agentId) {
    const [newest] = await loadContentAvatarOptions(gate.service, gate.organisationId);
    agentId = newest?.id ?? null;
  }
  const avatarRow = agentId
    ? await loadContentAvatarRow(gate.service, gate.organisationId, agentId)
    : null;
  if (parsed.data.agentId && !avatarRow) {
    return contentError("Avatar gehört nicht zu dieser Organisation.", 404);
  }

  const saved = await saveContentSettings(gate.service, {
    organisationId: gate.organisationId,
    settings: parsed.data.settings,
    avatarAgentId: avatarRow?.id ?? null,
    userId: gate.userId,
  });
  if (!saved.ok) return contentError(`Einstellungen konnten nicht gespeichert werden: ${saved.error}`, 500);

  const problems: string[] = [];
  if (filledWorkshopSections(sections) === 0) {
    problems.push("Noch keine Anbieterfakten aus den Gesprächen. Bitte erst unter Transkripte auswerten.");
  }
  if (!avatarRow) problems.push("Kein Avatar vorhanden.");
  if (!structure) problems.push("Keine Webseitenstruktur hochgeladen.");

  const anbieter = anbieterFromWorkshop(sections, {
    organisationName: (organisation?.name as string | undefined) ?? "",
  });
  const sent: ContentClientPutBody = {
    anbieter: mergeContentAnbieter(anbieter, parsed.data.settings),
    ...(avatarRow ? { avatar: avatarFromAgent(avatarRow) } : {}),
  };
  const result: ContentClientPutResult = {
    client: gate.organisationId,
    anbieter: filledWorkshopSections(sections) > 0,
    avatar: Boolean(avatarRow),
    structure: structure ? ((structure.filename as string | null) ?? "Struktur") : null,
    complete: problems.length === 0,
    problems,
  };
  return contentOk({ result, sent });
}
