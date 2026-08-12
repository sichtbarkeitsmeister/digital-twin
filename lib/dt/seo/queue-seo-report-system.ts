import { evaluateSeoReportReadiness } from "@/lib/dt/seo/report-readiness";
import { triggerDtSeoReportN8n } from "@/lib/dt/seo/trigger-report";
import { createServiceClient } from "@/lib/supabase/service";

export type QueueSeoReportSystemResult =
  | {
      ok: true;
      reportId: string;
      skipped?: false;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
      existingReportId?: string;
    }
  | {
      ok: false;
      message: string;
      code?: string;
    };

function calendarMonthBounds(now = new Date()): { startIso: string; endIso: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Queue + trigger an SEO report without a user session (monthly cron / internal).
 */
export async function queueAndTriggerSeoReportSystem(input: {
  organisationId: string;
  recipientType?: "intern" | "kunde";
  sendToOwner?: boolean;
  triggerSource?: string;
  /** Skip if a monthly report already exists this calendar month (unless error/cancelled). */
  dedupeMonthly?: boolean;
}): Promise<QueueSeoReportSystemResult> {
  const supabase = createServiceClient();
  const organisationId = input.organisationId;
  const recipientType = input.recipientType ?? "kunde";
  const sendToOwner = input.sendToOwner ?? true;
  const triggerSource = input.triggerSource ?? "monthly_scheduler";

  const { data: config } = await supabase
    .from("dt_org_config")
    .select(
      "seo_enabled,disabled,website_url,report_recipient_email,ga4_account,gsc_account,focus_keyword,report_timeframe",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle();

  const { data: orgRow } = await supabase
    .from("organisations")
    .select("slug, name")
    .eq("id", organisationId)
    .maybeSingle();

  if (!config?.seo_enabled) {
    return { ok: false, message: "SEO ist nicht aktiviert.", code: "seo_not_enabled" };
  }
  if (config.disabled) {
    return { ok: false, message: "Organisation ist deaktiviert.", code: "org_disabled" };
  }
  if (!String(config.report_recipient_email ?? "").trim()) {
    return {
      ok: false,
      message: "Report-E-Mail fehlt in den SEO-Einstellungen.",
      code: "missing_recipient_email",
    };
  }

  const readiness = evaluateSeoReportReadiness({
    organisationSlug: orgRow?.slug,
    websiteUrl: config.website_url,
    ga4Account: config.ga4_account,
    gscAccount: config.gsc_account,
  });
  if (!readiness.ok) {
    return {
      ok: false,
      message: readiness.blockers.map((b) => b.message).join(" "),
      code: "not_ready",
    };
  }

  if (input.dedupeMonthly !== false && triggerSource === "monthly_scheduler") {
    const { startIso, endIso } = calendarMonthBounds();
    const { data: existing } = await supabase
      .from("dt_seo_reports")
      .select("id, state")
      .eq("organisation_id", organisationId)
      .eq("trigger_source", "monthly_scheduler")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(5);

    const blocking = (existing ?? []).find(
      (r) => r.state === "queued" || r.state === "running" || r.state === "done",
    );
    if (blocking) {
      return {
        ok: true,
        skipped: true,
        reason: `Monatsreport bereits vorhanden (${blocking.state}).`,
        existingReportId: blocking.id,
      };
    }
  }

  const { data: reportId, error } = await supabase.rpc("dt_queue_seo_report_system", {
    p_organisation_id: organisationId,
    p_recipient_type: recipientType,
    p_send_to_owner: sendToOwner,
    p_trigger_source: triggerSource,
  });

  if (error || typeof reportId !== "string") {
    const msg = error?.message ?? "Report konnte nicht angelegt werden.";
    return { ok: false, message: msg, code: "queue_failed" };
  }

  try {
    await triggerDtSeoReportN8n(reportId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "n8n nicht erreichbar";
    await supabase
      .from("dt_seo_reports")
      .update({
        state: "error",
        state_message: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", reportId);
    try {
      const { sendDtSeoReportFailureAlert } = await import("@/lib/dt/seo/notify-owner");
      await sendDtSeoReportFailureAlert({
        supabase,
        organisationId,
        reportId,
        stateMessage: message,
        triggerSource,
      });
    } catch {
      // best-effort
    }
    return { ok: false, message, code: "n8n_trigger_failed" };
  }

  return { ok: true, reportId };
}

export type MonthlyReportOrgCandidate = {
  organisationId: string;
  slug: string;
  displayName: string | null;
  websiteUrl: string | null;
  reportRecipientEmail: string | null;
};

/** SEO-enabled orgs that pass hard readiness for automated reports. */
export async function listOrgsReadyForMonthlySeoReport(): Promise<MonthlyReportOrgCandidate[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("dt_org_config")
    .select(
      "organisation_id,display_name,website_url,report_recipient_email,ga4_account,gsc_account,organisations(slug)",
    )
    .eq("seo_enabled", true)
    .eq("disabled", false);

  if (error) throw new Error(error.message);

  const out: MonthlyReportOrgCandidate[] = [];
  for (const row of data ?? []) {
    const slug = (row.organisations as { slug?: string } | null)?.slug?.trim() ?? "";
    const readiness = evaluateSeoReportReadiness({
      organisationSlug: slug,
      websiteUrl: row.website_url,
      ga4Account: (row as { ga4_account?: string | null }).ga4_account,
      gscAccount: (row as { gsc_account?: string | null }).gsc_account,
    });
    if (!readiness.ok) continue;
    if (!String(row.report_recipient_email ?? "").trim()) continue;
    out.push({
      organisationId: row.organisation_id,
      slug,
      displayName: row.display_name,
      websiteUrl: row.website_url,
      reportRecipientEmail: row.report_recipient_email,
    });
  }
  return out;
}
