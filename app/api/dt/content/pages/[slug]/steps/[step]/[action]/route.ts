import { z } from "zod";

import {
  approveContentStep,
  editContentBlock,
  rerunContentStep,
  type ActionResult,
} from "@/lib/dt/content/pipeline/actions";
import {
  contentError,
  contentOk,
  gateContentRoute,
  isValidContentSlug,
  parseContentStep,
  readJsonBody,
} from "@/lib/dt/content/route-helpers";
import { loadContentPage } from "@/lib/dt/content/store";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";

export const maxDuration = 300;

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

/** approve | edit | run for one step; the acting user is always the signed-in one. */
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

  const page = await loadContentPage(gate.service, gate.organisationId, slug);
  if (!page) return contentError("Seite nicht gefunden.", 404);

  const data = parsed.data as { block_id?: string; text?: string; note?: string };
  let result: ActionResult;
  if (action === "approve") {
    result = await approveContentStep(gate.service, page, step, gate.userId);
  } else if (action === "edit") {
    result = await editContentBlock(gate.service, page, data.block_id!, data.text!);
  } else {
    result = await rerunContentStep(gate.service, page, step, data.note!, gate.userId);
  }
  if (!result.ok) return contentError(result.message, result.status);

  if (result.jobId) kickJobsWorker(1);
  return contentOk({ ok: true, step, action, job_id: result.jobId });
}
