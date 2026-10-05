import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_PHONE_NOTE,
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SUPPORT_NOTE,
  onboardingDashboardPath,
  type DtOnboardingCustomerContact,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";
import {
  itContactCoversHosterAndSmtp,
  onboardingChecklist,
} from "@/lib/dt/onboarding/normalize";

function statusLine(label: string, ok: boolean): string {
  return `- ${label}: ${ok ? "hinterlegt" : "noch offen"}`;
}

function accessStatus(label: string, viaIt: boolean, credentialsOk: boolean): string {
  if (viaIt) return `- ${label}: IT-Kontakt hinterlegt, wird dort abgefragt`;
  return statusLine(label, credentialsOk);
}

function itContactLines(record: DtOnboardingRecord): string[] {
  const contact = record.itContact;
  const parts = [
    contact.name.trim(),
    contact.company.trim(),
    contact.email.trim(),
    contact.phone.trim(),
  ].filter(Boolean);
  if (parts.length === 0) return ["Noch nicht angegeben."];
  return [
    `- ${parts.join(" · ")}`,
    "Hoster-Zugang und SMTP-Daten bei dieser Person abfragen, nicht beim Kunden einfordern.",
  ];
}

function customerContactLines(contacts: DtOnboardingCustomerContact[]): string[] {
  const filled = contacts.filter(
    (contact) => contact.name.trim() || contact.email.trim() || contact.phone.trim(),
  );
  if (filled.length === 0) return ["Noch nicht angegeben."];
  return filled.map((contact) => {
    const parts = [
      contact.name.trim() || "Ohne Namen",
      contact.role.trim(),
      contact.email.trim(),
      contact.phone.trim(),
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });
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
  if (!input.record) {
    return [
      "## Onboarding",
      `Onboarding-Daten für diese Organisation liegen unter ${dashboard}.`,
      "Passwörter, Zugangsdaten und Passflow-Links darfst du niemals aus dem Chat vorlesen — verweise auf die Onboarding-Seite.",
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
  const viaIt = itContactCoversHosterAndSmtp(input.record);
  const credentialHoster = Boolean(input.record.hosterUser && input.record.hosterPassword);
  const credentialSmtp = Boolean(
    input.record.smtpHost &&
      input.record.smtpPort &&
      input.record.smtpUsername &&
      input.record.smtpPassword,
  );

  return [
    "## Onboarding",
    `Die Onboarding-Seite dieser Organisation ist ${dashboard}.`,
    "Passwörter (Hoster, SMTP, CMS) und Passflow-Links niemals im Chat ausgeben. Immer auf die Onboarding-Seite verweisen, dort sind sie abrufbar.",
    "",
    "### Status",
    statusLine("Bilder und Videos", checklist.mediaLink),
    accessStatus("Hoster-Zugang", viaIt, credentialHoster),
    accessStatus("SMTP-Zugang", viaIt, credentialSmtp),
    statusLine("CMS-Zugang", checklist.cms),
    statusLine("Passflow-Link", Boolean(input.record.passflowUrl.trim())),
    statusLine("Mitbewerber", checklist.competitors),
    statusLine("Buchhaltungs-E-Mail", checklist.billingEmail),
    statusLine("Ansprechpartner Kunde", checklist.customerContacts),
    `- Hochgeladene Dateien: ${input.fileCount}`,
    "",
    `Bilder und Dateien liegen auf der Onboarding-Seite unter „Bilder und Videos“.`,
    input.record.billingEmail
      ? `Buchhaltungs-E-Mail: ${input.record.billingEmail}`
      : "Buchhaltungs-E-Mail: noch nicht angegeben.",
    competitors.length > 0
      ? `Mitbewerber: ${competitors.join(", ")}`
      : "Mitbewerber: noch nicht angegeben.",
    "",
    ...(input.record.accessViaIt
      ? [
          "### IT-Ansprechpartner für Hoster und SMTP",
          ...itContactLines(input.record),
          "",
        ]
      : []),
    "### Ansprechpartner beim Kunden",
    ...customerContactLines(input.record.customerContacts),
    input.record.additionalInfo.trim()
      ? `Weitere Informationen: ${input.record.additionalInfo.trim()}`
      : "Weitere Informationen: keine.",
    "",
    "### Direkte Ansprechpartner (Sichtbarkeitsmeister)",
    ...DT_ONBOARDING_CONTACTS.map((c) => `- ${c.name}: ${c.role}`),
    "",
    `Wichtigste E-Mail: ${DT_ONBOARDING_SUPPORT_EMAIL}`,
    DT_ONBOARDING_SUPPORT_NOTE,
    DT_ONBOARDING_PHONE_NOTE,
  ].join("\n");
}
