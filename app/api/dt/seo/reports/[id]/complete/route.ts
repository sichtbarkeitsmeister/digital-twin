import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import { syncSeoTasksFromReportRecommendations } from "@/lib/dt/seo/report-task-sync";
import { createServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  state: z.enum(["running", "done", "error"]),
  stateMessage: z.string().max(2000).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  pdfPath: z.string().max(500).nullable().optional(),
});

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!verifyDtInternalWebhookSecret(req)) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const patch: Record<string, unknown> = {
    state: parsed.data.state,
    state_message: parsed.data.stateMessage ?? null,
  };

  if (parsed.data.state === "running") {
    patch.started_at = new Date().toISOString();
  }
  if (parsed.data.state === "done") {
    patch.finished_at = new Date().toISOString();
    if (parsed.data.payload) patch.payload = parsed.data.payload;
    if (parsed.data.pdfPath !== undefined) patch.pdf_path = parsed.data.pdfPath;
  }
  if (parsed.data.state === "error") {
    patch.finished_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("dt_seo_reports")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: error?.message ?? "Update fehlgeschlagen." }, { status: 500 });
  }

  if (parsed.data.state === "done" && parsed.data.payload?.recommendations) {
    try {
      await syncSeoTasksFromReportRecommendations(
        supabase,
        id,
        data.organisation_id,
        parsed.data.payload.recommendations,
      );
    } catch (taskError) {
      console.error("[seo/report/complete] task sync failed:", taskError);
    }
  }

  return NextResponse.json({ ok: true, report: data });
}
