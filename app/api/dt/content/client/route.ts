import { z } from "zod";

import { contentAgentJson } from "@/lib/dt/content/client";
import { demoPutClient } from "@/lib/dt/content/fixtures";
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
import {
  contentError,
  contentOk,
  gateContentRoute,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
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
 * Builds `anbieter` (workshop sections + confirmed text settings) and `avatar` server-side
 * and sends them to the Content-Agent.
 */
export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const [{ data: organisation }, sections] = await Promise.all([
    gate.supabase.from("organisations").select("name").eq("id", gate.organisationId).maybeSingle(),
    loadContentWorkshopAnbieter(gate.supabase, gate.organisationId).catch(() => []),
  ]);
  if (filledWorkshopSections(sections) === 0) {
    return contentError(
      "Noch keine Anbieterfakten aus den Gesprächen. Bitte erst unter Transkripte auswerten.",
      400,
    );
  }

  let agentId = parsed.data.agentId ?? null;
  if (!agentId) {
    const [newest] = await loadContentAvatarOptions(gate.supabase, gate.organisationId);
    agentId = newest?.id ?? null;
  }
  const avatarRow = agentId
    ? await loadContentAvatarRow(gate.supabase, gate.organisationId, agentId)
    : null;
  if (!avatarRow) {
    return contentError(
      parsed.data.agentId ? "Avatar gehört nicht zu dieser Organisation." : "Kein Avatar vorhanden.",
      parsed.data.agentId ? 404 : 400,
    );
  }

  const anbieter = anbieterFromWorkshop(sections, {
    organisationName: (organisation?.name as string | undefined) ?? "",
  });
  const body: ContentClientPutBody = {
    anbieter: mergeContentAnbieter(anbieter, parsed.data.settings),
    avatar: avatarFromAgent(avatarRow),
  };

  if (!gate.config) {
    return contentOk({ result: demoPutClient(gate.clientKey, body), sent: body }, true);
  }

  const result = await contentAgentJson<ContentClientPutResult>(
    gate.config,
    `/clients/${encodeURIComponent(gate.clientKey)}`,
    { method: "PUT", body },
  );
  if (!result.ok) return contentError(result.message, result.status >= 400 ? result.status : 502);
  return contentOk({ result: result.data, sent: body }, false);
}
