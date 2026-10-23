import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { approveDraft, rejectDraft, saveDraft, type ActionResult } from "@/lib/dt/seo/grounding-check/actions";
import { normalizeChecklist } from "@/lib/dt/seo/grounding-check/review";
import { loadRunRow, serializeRunDetail } from "@/lib/dt/seo/grounding-check/store";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingRunRow } from "@/lib/dt/types";

const bodySchema = z.object({
  action: z.enum(["save", "approve", "reject"]),
  reviewChecklist: z.record(z.string(), z.boolean()).optional(),
  reviewerName: z.string().trim().max(200).optional(),
  reviewNote: z.string().trim().max(2_000).nullable().optional(),
  draftHtml: z.string().max(1_500_000).optional(),
  draftLlmsTxt: z.string().max(300_000).optional(),
  facts: z
    .array(z.object({ entityId: z.string().min(1).max(120), factId: z.string().max(160).nullable().optional(), included: z.boolean() }))
    .max(200)
    .optional(),
  faq: z.array(z.object({ faqId: z.string().min(1).max(120), included: z.boolean() })).max(50).optional(),
});

/**
 * Review a draft: `save` (edit the files or switch facts/FAQ), `approve` (six review points
 * + reviewer name; stamps the review into both files) or `reject`.
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." }, { status: 400 });
  }
  const { id } = await context.params;
  const service = createServiceClient();
  let run: DtGroundingRunRow | null;
  try {
    run = await loadRunRow(service, id);
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Prüfung nicht gefunden." }, { status: 500 });
  }
  if (!run) return NextResponse.json({ ok: false, message: "Prüfung nicht gefunden." }, { status: 404 });
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, run.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const body = parsed.data;
  let result: ActionResult<DtGroundingRunRow>;
  try {
    if (body.action === "save") {
      result = await saveDraft(service, run, { draftHtml: body.draftHtml, draftLlmsTxt: body.draftLlmsTxt, facts: body.facts, faq: body.faq });
    } else if (body.action === "approve") {
      result = await approveDraft(service, run, {
        userId: auth.userId,
        reviewerName: body.reviewerName ?? "",
        checklist: normalizeChecklist(body.reviewChecklist),
        note: body.reviewNote,
      });
    } else {
      result = await rejectDraft(service, run, {
        userId: auth.userId,
        reviewerName: body.reviewerName ?? "",
        checklist: body.reviewChecklist ? normalizeChecklist(body.reviewChecklist) : null,
        note: body.reviewNote,
      });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Speichern fehlgeschlagen." }, { status: 500 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message, validation: result.validation ?? null }, { status: result.status });
  }
  return NextResponse.json({ ok: true, run: serializeRunDetail(result.value) });
}
