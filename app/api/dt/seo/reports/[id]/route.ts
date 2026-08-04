import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoReportAccess } from "@/lib/dt/seo/access";
import { syncReportJobHealth } from "@/lib/dt/seo/sync-report-job-health";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthUser();
  if (!auth.ok || !auth.userId) {
    return NextResponse.json({ ok: false, message: "Nicht angemeldet." }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: report } = await auth.supabase
    .from("dt_seo_reports")
    .select("organisation_id")
    .eq("id", id)
    .maybeSingle();

  if (!report?.organisation_id) {
    return NextResponse.json({ ok: false, message: "Report nicht gefunden." }, { status: 404 });
  }

  const gate = await requireDtSeoReportAccess(auth.supabase, auth.userId, report.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  await syncReportJobHealth({
    organisationId: report.organisation_id,
    reportId: id,
  });

  const { data, error } = await auth.supabase
    .from("dt_seo_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: false, message: "Report nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, report: data });
}
