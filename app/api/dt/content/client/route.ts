import { z } from "zod";

import { contentAgentJson } from "@/lib/dt/content/client";
import { demoPutClient } from "@/lib/dt/content/fixtures";
import {
  loadContentAnbieterSource,
  loadContentAvatarOptions,
  loadContentAvatarRow,
} from "@/lib/dt/content/load-sources";
import { anbieterFromSurvey, avatarFromAgent } from "@/lib/dt/content/mapping";
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
});

/** Builds `anbieter` + `avatar` from DigitalTwin data server-side and sends them to the Content-Agent. */
export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return contentError("Ungültige Anfrage.", 400);

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const { data: organisation } = await gate.supabase
    .from("organisations")
    .select("name")
    .eq("id", gate.organisationId)
    .maybeSingle();

  const anbieterSource = await loadContentAnbieterSource(gate.supabase, gate.organisationId);

  let agentId = parsed.data.agentId ?? null;
  if (!agentId) {
    const [newest] = await loadContentAvatarOptions(gate.supabase, gate.organisationId);
    agentId = newest?.id ?? null;
  }
  const avatarRow = agentId
    ? await loadContentAvatarRow(gate.supabase, gate.organisationId, agentId)
    : null;
  if (parsed.data.agentId && !avatarRow) {
    return contentError("Avatar gehört nicht zu dieser Organisation.", 404);
  }

  const body: ContentClientPutBody = {};
  if (anbieterSource) {
    body.anbieter = anbieterFromSurvey({
      definition: anbieterSource.definition,
      answers: anbieterSource.answers,
      organisationName: (organisation?.name as string | undefined) ?? null,
    });
  }
  if (avatarRow) body.avatar = avatarFromAgent(avatarRow);

  if (!body.anbieter && !body.avatar) {
    return contentError(
      "Weder Anbieter-Fragebogen noch Avatar gefunden. Es gibt nichts zu übertragen.",
      400,
    );
  }

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
