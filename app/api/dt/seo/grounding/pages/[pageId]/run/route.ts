import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess } from "@/lib/dt/seo/access";
import { DT_GROUNDING_PAGE_SELECT, summarizeGroundingPages } from "@/lib/dt/seo/grounding-pages";
import { loadGroundingPageViews } from "@/lib/dt/seo/grounding-pages-server";
import {
  answerGroundingQuestions,
  rebuildGroundingPage,
  resetGroundingRun,
  startGroundingRun,
  stopGroundingRun,
  type GroundingActionResult,
} from "@/lib/dt/seo/grounding-run/actions";
import { loadGroundingSteps } from "@/lib/dt/seo/grounding-run/store";
import { kickJobsWorker } from "@/lib/jobs/kick-worker";
import { createServiceClient } from "@/lib/supabase/service";
import type { DtGroundingPageRow } from "@/lib/dt/types";

export const maxDuration = 60;

const bodySchema = z.object({
  organisationId: z.string().uuid(),
  action: z.enum(["start", "continue", "answer", "stop", "reset", "restart", "rebuild"]),
  /** answer: the customer's answers; rebuild: the editorial note. */
  text: z.string().trim().max(8_000).optional(),
});

/**
 * Actions on the Grounding draft of one page: start / continue the run, answer the
 * Faktencheck questions (or skip them with empty text), stop, reset, restart, rebuild
 * the page from the facts with a note.
 */
export async function POST(req: Request, context: { params: Promise<{ pageId: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Anfrage." }, { status: 400 });
  }
  const { pageId } = await context.params;
  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, parsed.data.organisationId);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("dt_grounding_pages")
    .select(DT_GROUNDING_PAGE_SELECT)
    .eq("id", pageId)
    .eq("organisation_id", parsed.data.organisationId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }
  const page = (data as DtGroundingPageRow | null) ?? null;
  if (!page) {
    return NextResponse.json({ ok: false, message: "Grounding Page nicht gefunden." }, { status: 404 });
  }

  let result: GroundingActionResult;
  try {
    switch (parsed.data.action) {
      case "start":
      case "continue":
        result = await startGroundingRun(service, page, auth.userId);
        break;
      case "answer":
        result = await answerGroundingQuestions(service, page, parsed.data.text ?? "", auth.userId);
        break;
      case "stop":
        result = await stopGroundingRun(service, page, await loadGroundingSteps(service, page.id));
        break;
      case "reset":
        result = await resetGroundingRun(service, page);
        break;
      case "restart":
        result = await resetGroundingRun(service, page, { restart: true, keepNotes: true, userId: auth.userId });
        break;
      case "rebuild":
        result = await rebuildGroundingPage(service, page, parsed.data.text ?? "", auth.userId);
        break;
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Aktion fehlgeschlagen." },
      { status: 500 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
  }
  if (result.jobId) kickJobsWorker(1);

  const pages = await loadGroundingPageViews(auth.supabase, parsed.data.organisationId);
  return NextResponse.json({ ok: true, pages, summary: summarizeGroundingPages(pages), jobId: result.jobId });
}
