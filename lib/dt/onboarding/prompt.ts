import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_PHONE_NOTE,
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SUPPORT_NOTE,
  onboardingDashboardPath,
  onboardingPublicPath,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";
import { onboardingChecklist } from "@/lib/dt/onboarding/normalize";

function statusLine(label: string, ok: boolean): string {
  return `- ${label}: ${ok ? "hinterlegt" : "noch offen"}`;
}

/**
 * Safe context for the DigitalTwin. Never includes passwords or SMTP/CMS/hoster secrets.
 */
export function formatOnboardingForPrompt(input: {
  record: DtOnboardingRecord | null;
  organisationId: string;
  fileCount: number;
  appBaseUrl?: string;
}): string {
  const dashboard = onboardingDashboardPath(input.organisationId);
  if (!input.record?.uploadToken) {
    return [
      "## Onboarding",
      `Onboarding-Daten für diese Organisation liegen unter ${dashboard}.`,
      "Passwörter und Zugangsdaten darfst du niemals aus dem Chat vorlesen — verweise auf die Onboarding-Seite.",
      "",
      "### Direkte Ansprechpartner (Sichtbarkeitsmeister)",
      ...DT_ONBOARDING_CONTACTS.map((c) => `- ${c.name}: ${c.role}`),
      "",
      DT_ONBOARDING_SUPPORT_NOTE,
      DT_ONBOARDING_PHONE_NOTE,
    ].join("\n");
  }

  const checklist = onboardingChecklist(input.record, input.fileCount);
  const competitors = input.record.competitors.map((item) => item.trim()).filter(Boolean);
  const publicPath = onboardingPublicPath(input.record.uploadToken);
  const publicUrl = input.appBaseUrl
    ? `${input.appBaseUrl.replace(/\/+$/, "")}${publicPath}`
    : publicPath;

  return [
    "## Onboarding",
    `Die Onboarding-Seite dieser Organisation ist ${dashboard}.`,
    "Passwörter (Cloud, Hoster, SMTP, CMS) niemals im Chat ausgeben. Immer auf die Onboarding-Seite verweisen, dort sind sie abrufbar.",
    "",
    "### Status",
    statusLine("Cloud-Upload-Link", checklist.mediaLink),
    statusLine("Hoster-Zugang", checklist.hoster),
    statusLine("SMTP-Zugang", checklist.smtp),
    statusLine("CMS-Zugang", checklist.cms),
    statusLine("Mitbewerber", checklist.competitors),
    statusLine("Buchhaltungs-E-Mail", checklist.billingEmail),
    `- Hochgeladene Dateien: ${input.fileCount}`,
    "",
    `Upload-Link (nur Upload, kein Download von außen): ${publicUrl}`,
    input.record.billingEmail
      ? `Buchhaltungs-E-Mail: ${input.record.billingEmail}`
      : "Buchhaltungs-E-Mail: noch nicht angegeben.",
    competitors.length > 0
      ? `Mitbewerber: ${competitors.join(", ")}`
      : "Mitbewerber: noch nicht angegeben.",
    "",
    "### Direkte Ansprechpartner (Sichtbarkeitsmeister)",
    ...DT_ONBOARDING_CONTACTS.map((c) => `- ${c.name}: ${c.role}`),
    "",
    `Wichtigste E-Mail: ${DT_ONBOARDING_SUPPORT_EMAIL}`,
    DT_ONBOARDING_SUPPORT_NOTE,
    DT_ONBOARDING_PHONE_NOTE,
  ].join("\n");
}
