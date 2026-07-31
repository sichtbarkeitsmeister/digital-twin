import { NextResponse } from "next/server";
import { z } from "zod";

import { queueDtSeoReport, requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess, requireDtSeoReportAccess } from "@/lib/dt/seo/access";
import { syncReportJobHealth } from "@/lib/dt/seo/sync-report-job-health";
import { triggerDtSeoReportN8n } from "@/lib/dt/seo/trigger-report";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const querySchema = z.object({
  org: z.string().uuid(),
});

const postSchema = z.object({
  organisationId: z.string().uuid(),
  recipientType: z.enum(["intern", "kunde"]).default("kunde"),
  sendToOwner: z.boolean().default(false),
});

export async function GET(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ org: url.searchParams.get("org") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Ungültige Organisation." }, { status: 400 });
  }

  const gate = await requireDtSeoReportAccess(auth.supabase, auth.userId!, parsed.data.org);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  await syncReportJobHealth({ organisationId: parsed.data.org });

  const { data, error } = await auth.supabase
    .from("dt_seo_reports")
    .select(
      "id,organisation_id,recipient_type,recipient_email,send_to_owner,owner_sent_at,state,state_message,pdf_path,followup_due_at,started_at,finished_at,created_at,updated_at",
    )
    .eq("organisation_id", parsed.data.org)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reports: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }

  const gate = await requireDtSeoAccess(
    auth.supabase,
    auth.userId,
    parsed.data.organisationId,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  const { reportId, error } = await queueDtSeoReport({
    organisationId: parsed.data.organisationId,
    recipientType: parsed.data.recipientType,
    sendToOwner: parsed.data.sendToOwner,
  });

  if (!reportId) {
    const msg =
      error === "seo_not_enabled"
        ? "SEO ist für diese Organisation nicht aktiviert."
        : error === "missing_recipient_email"
          ? "Bitte zuerst eine Report-E-Mail in den SEO-Einstellungen hinterlegen."
          : (error ?? "Report konnte nicht gestartet werden.");
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return NextResponse.json({ ok: false, message: "Session fehlt." }, { status: 401 });
  }

  try {
    await triggerDtSeoReportN8n(reportId, token);
  } catch (err) {
    // dt_seo_reports has no user UPDATE policy (RLS is select-only), so the
    // failure state must be written with the service role.
    await createServiceClient()
      .from("dt_seo_reports")
      .update({
        state: "error",
        state_message: err instanceof Error ? err.message : "n8n nicht erreichbar",
        finished_at: new Date().toISOString(),
      })
      .eq("id", reportId);
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Workflow-Start fehlgeschlagen." },
      { status: 502 },
    );
  }

  const { data: report } = await auth.supabase
    .from("dt_seo_reports")
    .select("*")
    .eq("id", reportId)
    .single();

  return NextResponse.json({ ok: true, report });
}
