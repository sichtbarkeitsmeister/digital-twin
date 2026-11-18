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
import { contentStepText } from "@/lib/dt/content/step-text";
import { loadContentPage, loadContentSteps } from "@/lib/dt/content/store";
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

/**
 * `GET …/steps/{n}/text?org=…`: the text as it was after step n („Zwischenstand“), from the step's
 * row, with the Abschnitte that changed against the text step before it. Read only, no model.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ slug: string; step: string; action: string }> },
) {
  const { slug, step: rawStep, action } = await context.params;
  const step = parseContentStep(rawStep);
  if (!isValidContentSlug(slug) || step == null || action !== "text") return contentError("Unbekannte Aktion.", 404);
  const gated = await gateContentRoute(new URL(req.url).searchParams.get("org"));
  if (!gated.ok) return gated.response;
  const { gate } = gated;
  try {
    const page = await loadContentPage(gate.service, gate.organisationId, slug);
    if (!page) return contentError("Seite nicht gefunden.", 404);
    const text = contentStepText(await loadContentSteps(gate.service, page.id), step);
    if (!text) {
      return contentError("Zu diesem Schritt ist kein Text gespeichert (der Schritt schreibt keinen Text, lief noch nicht oder wurde zurückgesetzt).", 404);
    }
    return contentOk(text);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Der Text des Schritts konnte nicht geladen werden.", 500);
  }
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

  let page;
  try {
    page = await loadContentPage(gate.service, gate.organisationId, slug);
  } catch (error) {
    return contentError(error instanceof Error ? error.message : "Seite konnte nicht geladen werden.", 500);
  }
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
