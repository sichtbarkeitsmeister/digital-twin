import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";

async function resolveReportRecipientEmail(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<string | null> {
  const { data: cfg } = await supabase
    .from("dt_org_config")
    .select("report_recipient_email")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  const email = cfg?.report_recipient_email?.trim();
  return email && email.includes("@") ? email : null;
}

/**
 * Emails the finished SEO report to the configured report recipient
 * (`dt_org_config.report_recipient_email`). Best-effort: returns a reason
 * instead of throwing so a delivery hiccup never blocks the report-completion
 * callback.
 */
export async function sendDtSeoReportToOwner(input: {
  supabase: SupabaseClient;
  organisationId: string;
  reportId: string;
  pdfPath: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipientEmail = await resolveReportRecipientEmail(input.supabase, input.organisationId);
  if (!recipientEmail) {
    return { sent: false, reason: "Keine Report-E-Mail in den SEO-Einstellungen hinterlegt." };
  }

  const { data: cfg } = await input.supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();
  const orgName = cfg?.display_name?.trim() || "Ihre Organisation";

  const base = getAppBaseUrl();
  const reportLink = `${base}/dashboard/verwaltung/seo/reports/${input.reportId}?org=${encodeURIComponent(
    input.organisationId,
  )}`;

  const pdfLine =
    input.pdfPath && /^https?:\/\//i.test(input.pdfPath)
      ? `\nPDF: ${input.pdfPath}`
      : "";

  const subject = `Neuer SEO-Report für ${orgName}`;
  const text =
    `Hallo,\n\n` +
    `für ${orgName} wurde ein neuer SEO-Report erstellt.\n\n` +
    `Report ansehen: ${reportLink}${pdfLine}\n\n` +
    `Viele Grüße\nIhr Sichtbarkeitsmeister-Team`;
  const html =
    `<p>Hallo,</p>` +
    `<p>für <strong>${orgName}</strong> wurde ein neuer SEO-Report erstellt.</p>` +
    `<p><a href="${reportLink}">Report ansehen</a>${
      input.pdfPath && /^https?:\/\//i.test(input.pdfPath)
        ? ` · <a href="${input.pdfPath}">PDF herunterladen</a>`
        : ""
    }</p>` +
    `<p>Viele Grüße<br/>Ihr Sichtbarkeitsmeister-Team</p>`;

  try {
    await sendEmail({ to: [recipientEmail], subject, text, html });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen." };
  }
}

/**
 * Alert when an SEO report fails — emails the configured report recipient
 * (usually SBKM) so errors are visible without watching n8n.
 */
export async function sendDtSeoReportFailureAlert(input: {
  supabase: SupabaseClient;
  organisationId: string;
  reportId: string;
  stateMessage: string | null;
  triggerSource?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipientEmail = await resolveReportRecipientEmail(input.supabase, input.organisationId);
  const alertExtra = process.env.DT_SEO_ALERT_EMAIL?.trim();
  const to = Array.from(
    new Set([recipientEmail, alertExtra].filter((e): e is string => Boolean(e && e.includes("@")))),
  );
  if (to.length === 0) {
    return { sent: false, reason: "Keine Report-/Alert-E-Mail hinterlegt." };
  }

  const { data: cfg } = await input.supabase
    .from("dt_org_config")
    .select("display_name")
    .eq("organisation_id", input.organisationId)
    .maybeSingle();
  const orgName = cfg?.display_name?.trim() || "Organisation";

  const base = getAppBaseUrl();
  const reportLink = `${base}/dashboard/verwaltung/seo/reports/${input.reportId}?org=${encodeURIComponent(
    input.organisationId,
  )}`;
  const source =
    input.triggerSource === "monthly_scheduler" ? "Monatsreport (automatisch)" : "SEO-Report";
  const detail = input.stateMessage?.trim() || "Unbekannter Fehler";

  const subject = `Fehler: ${source} für ${orgName}`;
  const text =
    `Hallo,\n\n` +
    `der ${source} für ${orgName} ist fehlgeschlagen.\n\n` +
    `Fehler: ${detail}\n` +
    `Report: ${reportLink}\n\n` +
    `Bitte prüfen.\n`;
  const html =
    `<p>Hallo,</p>` +
    `<p>der <strong>${source}</strong> für <strong>${orgName}</strong> ist fehlgeschlagen.</p>` +
    `<p><strong>Fehler:</strong> ${detail.replace(/</g, "&lt;")}</p>` +
    `<p><a href="${reportLink}">Report in der Übersicht öffnen</a></p>` +
    `<p>Bitte prüfen.</p>`;

  try {
    await sendEmail({ to, subject, text, html });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen.",
    };
  }
}
