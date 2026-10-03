import { z } from "zod";

import { contentAgentJson } from "@/lib/dt/content/client";
import {
  contentError,
  contentFromAgent,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  parseContentStep,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";

const bodySchemas = {
  approve: z.object({ organisationId: z.string().uuid() }),
  edit: z.object({
    organisationId: z.string().uuid(),
    block_id: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(50_000),
  }),
  run: z.object({
    organisationId: z.string().uuid(),
    note: z.string().trim().min(1).max(5_000),
  }),
} as const;

type StepAction = keyof typeof bodySchemas;

function isStepAction(v: string): v is StepAction {
  return v in bodySchemas;
}

/** approve | edit | run for one step; `by` is always the signed-in user, never client input. */
export async function POST(
  req: Request,
  context: { params: Promise<{ slug: string; step: string; action: string }> },
) {
  const { slug, step: rawStep, action } = await context.params;
  const step = parseContentStep(rawStep);
  if (!isValidContentSlug(slug) || step == null || !isStepAction(action)) {
    return contentError("Unbekannte Aktion.", 404);
  }

  const parsed = bodySchemas[action].safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return contentError(
      action === "run"
        ? "Bitte eine Anmerkung eingeben."
        : action === "edit"
          ? "Bitte Abschnitt und neuen Text angeben."
          : "Ungültige Anfrage.",
      400,
    );
  }

  const gated = await gateContentRoute(parsed.data.organisationId);
  if (!gated.ok) return gated.response;
  const { gate } = gated;

  const by = gate.userEmail ?? gate.userId;
  const data = parsed.data as { block_id?: string; text?: string; note?: string };
  const body =
    action === "run"
      ? { note: data.note }
      : action === "edit"
        ? { block_id: data.block_id, text: data.text, by }
        : { by };

  if (!gate.config) {
    return contentOk({ ok: true, step, action }, true);
  }

  return contentFromAgent(
    await contentAgentJson<unknown>(
      gate.config,
      `/clients/${encodeURIComponent(gate.clientKey)}/pages/${encodeURIComponent(slug)}/steps/${step}/${action}`,
      { method: "POST", body, timeoutMs: 60_000 },
    ),
  );
}
