import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { rejectOpenDrafts, startGroundingCheck } from "@/lib/dt/seo/grounding-check/actions";
import { groundingRunsDbErrorMessage, serializeRunSummary } from "@/lib/dt/seo/grounding-check/store";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 30;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  /** Set aside a draft that still waits for review. */
  replaceDraft: z.boolean().optional(),
});

/**
 * „Website prüfen“: create a Grounding check for the organisation and queue it. The job
 * crawls, compares and leaves a draft; the tab polls GET /api/dt/seo/grounding/runs.
 */
export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." }, { status: 400 });
  }
  const { organisationId, replaceDraft } = parsed.data;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, organisationId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const service = createServiceClient();
  const { data: drafts, error } = await service
    .from("dt_grounding_runs")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("status", "draft")
    .limit(1);
  if (error) {
    return NextResponse.json({ ok: false, message: groundingRunsDbErrorMessage(error, "Prüfungen konnten nicht geladen werden") }, { status: 500 });
  }
  if ((drafts ?? []).length > 0) {
    if (!replaceDraft) {
      return NextResponse.json(
        {
          ok: false,
          code: "open_draft",
          message: "Ein Entwurf wartet noch auf Prüfung. Eine neue Prüfung verwirft diesen Entwurf.",
        },
        { status: 409 },
      );
    }
    await rejectOpenDrafts(service, organisationId, "Durch eine neue Prüfung ersetzt.");
  }

  const started = await startGroundingCheck(service, { organisationId, trigger: "manual", userId: auth.userId });
  if (!started.ok) {
    return NextResponse.json({ ok: false, message: started.message }, { status: started.status });
  }
  kickJobsWorker(1);
  return NextResponse.json({ ok: true, run: serializeRunSummary(started.value) });
}
