import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyDtInternalWebhookSecret } from "@/lib/dt/internal-webhook";
import {
  sendDtSeoReportFailureAlert,
  sendDtSeoReportToOwner,
} from "@/lib/dt/seo/notify-owner";
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

  // Idempotency guard: once a report has been stopped by a user (or already
  // finished), ignore any late callbacks from n8n so the final state sticks.
  const { data: current } = await supabase
    .from("dt_seo_reports")
    .select("id, state, send_to_owner, owner_sent_at, trigger_source, organisation_id")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ ok: false, message: "Report nicht gefunden." }, { status: 404 });
  }

  if (current.state === "cancelled") {
    return NextResponse.json({ ok: true, ignored: true, report: current });
  }

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

  // Optionally email the finished report to the configured report recipient (once).
  if (parsed.data.state === "done" && current.send_to_owner && !current.owner_sent_at) {
    try {
      const result = await sendDtSeoReportToOwner({
        supabase,
        organisationId: data.organisation_id,
        reportId: id,
        pdfPath: data.pdf_path ?? null,
      });
      if (result.sent) {
        await supabase
          .from("dt_seo_reports")
          .update({ owner_sent_at: new Date().toISOString() })
          .eq("id", id);
      } else {
        console.warn("[seo/report/complete] report email skipped:", result.reason);
      }
    } catch (mailError) {
      console.error("[seo/report/complete] report email failed:", mailError);
    }
  }

  if (parsed.data.state === "error") {
    try {
      const alert = await sendDtSeoReportFailureAlert({
        supabase,
        organisationId: data.organisation_id,
        reportId: id,
        stateMessage: parsed.data.stateMessage ?? data.state_message ?? null,
        triggerSource: (current as { trigger_source?: string | null }).trigger_source,
      });
      if (!alert.sent) {
        console.warn("[seo/report/complete] failure alert skipped:", alert.reason);
      }
    } catch (alertError) {
      console.error("[seo/report/complete] failure alert failed:", alertError);
    }
  }

  return NextResponse.json({ ok: true, report: data });
}
