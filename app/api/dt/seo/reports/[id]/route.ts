import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/dt/db";
import { requireDtSeoAccess, requireDtSeoReportAccess } from "@/lib/dt/seo/access";
import { syncReportJobHealth } from "@/lib/dt/seo/sync-report-job-health";
import { createServiceClient } from "@/lib/supabase/service";

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

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
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

  const gate = await requireDtSeoAccess(auth.supabase, auth.userId, report.organisation_id);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, message: gate.message }, { status: gate.status });
  }

  // dt_seo_reports has no user DELETE policy (RLS is select-only).
  const { error } = await createServiceClient().from("dt_seo_reports").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message || "Report konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
