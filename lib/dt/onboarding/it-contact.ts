import type { DtOnboardingRecord } from "@/lib/dt/onboarding/copy";
import { itContactCoversHosterAndSmtp } from "@/lib/dt/onboarding/normalize";

function contactKey(record: DtOnboardingRecord): string {
  const contact = record.itContact;
  return [contact.name, contact.company, contact.email, contact.phone].join("\n");
}

/** Mail the team once a usable IT contact is saved, and again when it changes. */
export function shouldNotifyItContact(input: {
  previous: DtOnboardingRecord;
  next: DtOnboardingRecord;
}): boolean {
  if (!itContactCoversHosterAndSmtp(input.next)) return false;
  if (!itContactCoversHosterAndSmtp(input.previous)) return true;
  return contactKey(input.previous) !== contactKey(input.next);
}

export function buildItContactNotifyEmail(input: {
  orgName: string;
  dashboardUrl: string;
  contact: DtOnboardingRecord["itContact"];
}): { subject: string; text: string; html: string } {
  const orgName = input.orgName.trim() || "Organisation";
  const dashboardUrl = input.dashboardUrl.trim();
  const name = input.contact.name.trim() || "ohne Namen";
  const company = input.contact.company.trim();
  const email = input.contact.email.trim();
  const phone = input.contact.phone.trim();
  const lines = [
    company ? `Firma: ${company}` : "",
    email ? `E-Mail: ${email}` : "",
    phone ? `Telefon: ${phone}` : "",
  ].filter(Boolean);

  return {
    subject: `IT-Kontakt für Hoster und SMTP — ${orgName}`,
    text:
      `${orgName} hat statt der Hoster- und SMTP-Zugangsdaten einen IT-Kontakt hinterlegt.\n\n` +
      `Bitte Hoster-Login und SMTP-Zugang dort selbst abfragen.\n\n` +
      `${name}\n` +
      `${lines.join("\n")}\n\n` +
      `Onboarding: ${dashboardUrl}\n`,
    html:
      `<p><strong>${escapeHtml(orgName)}</strong> hat statt der Hoster- und SMTP-Zugangsdaten einen IT-Kontakt hinterlegt.</p>` +
      `<p>Bitte Hoster-Login und SMTP-Zugang dort selbst abfragen.</p>` +
      `<p><strong>${escapeHtml(name)}</strong><br>${lines.map(escapeHtml).join("<br>")}</p>` +
      `<p><a href="${escapeHtml(dashboardUrl)}">Onboarding öffnen</a></p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
