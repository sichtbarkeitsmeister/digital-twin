import {
  DT_ONBOARDING_ADDITIONAL_INFO_MAX,
  DT_ONBOARDING_MAX_COMPETITORS,
  DT_ONBOARDING_MAX_CUSTOMER_CONTACTS,
  DT_ONBOARDING_SMTP_PROTOCOLS,
  EMPTY_CUSTOMER_CONTACT,
  type DtOnboardingChecklist,
  type DtOnboardingCustomerContact,
  type DtOnboardingItContact,
  type DtOnboardingRecord,
} from "@/lib/dt/onboarding/copy";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function normalizeCompetitors(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|,|;/g)
      : [];
  const cleaned = raw
    .map((item) => (typeof item === "string" ? clip(item, 200) : ""))
    .filter(Boolean)
    .slice(0, DT_ONBOARDING_MAX_COMPETITORS);
  const padded = [...cleaned];
  while (padded.length < DT_ONBOARDING_MAX_COMPETITORS) padded.push("");
  return padded;
}

function normalizeCustomerContacts(value: unknown): DtOnboardingCustomerContact[] {
  const raw = Array.isArray(value) ? value : [];
  const cleaned: DtOnboardingCustomerContact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const contact: DtOnboardingCustomerContact = {
      name: clip(asString(row.name), 120),
      role: clip(asString(row.role), 120),
      email: clip(asString(row.email), 200),
      phone: clip(asString(row.phone), 80),
    };
    if (!contact.name && !contact.role && !contact.email && !contact.phone) continue;
    cleaned.push(contact);
    if (cleaned.length >= DT_ONBOARDING_MAX_CUSTOMER_CONTACTS) break;
  }
  const padded = [...cleaned];
  while (padded.length < DT_ONBOARDING_MAX_CUSTOMER_CONTACTS) {
    padded.push({ ...EMPTY_CUSTOMER_CONTACT });
  }
  return padded;
}
function asBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeItContact(src: Record<string, unknown>): DtOnboardingItContact {
  const nested =
    src.itContact && typeof src.itContact === "object"
      ? (src.itContact as Record<string, unknown>)
      : src.it_contact && typeof src.it_contact === "object"
        ? (src.it_contact as Record<string, unknown>)
        : null;
  return {
    name: clip(asString(nested?.name ?? src.it_contact_name), 120),
    company: clip(asString(nested?.company ?? src.it_contact_company), 160),
    email: clip(asString(nested?.email ?? src.it_contact_email), 200),
    phone: clip(asString(nested?.phone ?? src.it_contact_phone), 80),
  };
}

function normalizeProtocol(value: string): string {
  const upper = value.trim().toUpperCase();
  const match = DT_ONBOARDING_SMTP_PROTOCOLS.find((item) => item.toUpperCase() === upper);
  return match ?? (upper ? clip(value, 40) : "TLS");
}

export function normalizeOnboardingRecord(
  input: Partial<DtOnboardingRecord> | Record<string, unknown> | null | undefined,
): DtOnboardingRecord {
  const src = (input ?? {}) as Record<string, unknown>;
  return {
    uploadToken: clip(asString(src.uploadToken ?? src.upload_token), 64),
    uploadPassword: clip(asString(src.uploadPassword ?? src.upload_password), 80),
    hosterUser: clip(asString(src.hosterUser ?? src.hoster_user), 200),
    hosterPassword: clip(asString(src.hosterPassword ?? src.hoster_password), 200),
    accessViaIt: asBool(src.accessViaIt ?? src.access_via_it),
    itContact: normalizeItContact(src),
    smtpHost: clip(asString(src.smtpHost ?? src.smtp_host), 200),
    smtpPort: clip(asString(src.smtpPort ?? src.smtp_port), 12),
    smtpProtocol: normalizeProtocol(asString(src.smtpProtocol ?? src.smtp_protocol)),
    smtpUsername: clip(asString(src.smtpUsername ?? src.smtp_username), 200),
    smtpPassword: clip(asString(src.smtpPassword ?? src.smtp_password), 200),
    cmsLoginUrl: clip(asString(src.cmsLoginUrl ?? src.cms_login_url), 500),
    cmsUser: clip(asString(src.cmsUser ?? src.cms_user), 200),
    cmsPassword: clip(asString(src.cmsPassword ?? src.cms_password), 200),
    passflowUrl: clip(asString(src.passflowUrl ?? src.passflow_url), 500),
    competitors: normalizeCompetitors(src.competitors),
    billingEmail: clip(asString(src.billingEmail ?? src.billing_email), 200),
    customerContacts: normalizeCustomerContacts(
      src.customerContacts ?? src.customer_contacts,
    ),
    additionalInfo: clip(
      asString(src.additionalInfo ?? src.additional_info),
      DT_ONBOARDING_ADDITIONAL_INFO_MAX,
    ),
  };
}

export function onboardingRecordFromRow(row: {
  upload_token?: string | null;
  upload_password?: string | null;
  hoster_user?: string | null;
  hoster_password?: string | null;
  access_via_it?: boolean | null;
  it_contact_name?: string | null;
  it_contact_company?: string | null;
  it_contact_email?: string | null;
  it_contact_phone?: string | null;
  smtp_host?: string | null;
  smtp_port?: string | null;
  smtp_protocol?: string | null;
  smtp_username?: string | null;
  smtp_password?: string | null;
  cms_login_url?: string | null;
  cms_user?: string | null;
  cms_password?: string | null;
  passflow_url?: string | null;
  competitors?: unknown;
  billing_email?: string | null;
  customer_contacts?: unknown;
  additional_info?: string | null;
} | null): DtOnboardingRecord {
  if (!row) return normalizeOnboardingRecord(null);
  return normalizeOnboardingRecord({
    uploadToken: row.upload_token ?? "",
    uploadPassword: row.upload_password ?? "",
    hosterUser: row.hoster_user ?? "",
    hosterPassword: row.hoster_password ?? "",
    accessViaIt: row.access_via_it === true,
    itContact: {
      name: row.it_contact_name ?? "",
      company: row.it_contact_company ?? "",
      email: row.it_contact_email ?? "",
      phone: row.it_contact_phone ?? "",
    },
    smtpHost: row.smtp_host ?? "",
    smtpPort: row.smtp_port ?? "",
    smtpProtocol: row.smtp_protocol ?? "TLS",
    smtpUsername: row.smtp_username ?? "",
    smtpPassword: row.smtp_password ?? "",
    cmsLoginUrl: row.cms_login_url ?? "",
    cmsUser: row.cms_user ?? "",
    cmsPassword: row.cms_password ?? "",
    passflowUrl: row.passflow_url ?? "",
    competitors: row.competitors,
    billingEmail: row.billing_email ?? "",
    customerContacts: row.customer_contacts,
    additionalInfo: row.additional_info ?? "",
  });
}

export function onboardingRowFromRecord(record: DtOnboardingRecord) {
  return {
    upload_token: record.uploadToken,
    upload_password: record.uploadPassword,
    hoster_user: record.hosterUser || null,
    hoster_password: record.hosterPassword || null,
    access_via_it: record.accessViaIt,
    it_contact_name: record.itContact.name || null,
    it_contact_company: record.itContact.company || null,
    it_contact_email: record.itContact.email || null,
    it_contact_phone: record.itContact.phone || null,
    smtp_host: record.smtpHost || null,
    smtp_port: record.smtpPort || null,
    smtp_protocol: record.smtpProtocol || null,
    smtp_username: record.smtpUsername || null,
    smtp_password: record.smtpPassword || null,
    cms_login_url: record.cmsLoginUrl || null,
    cms_user: record.cmsUser || null,
    cms_password: record.cmsPassword || null,
    passflow_url: record.passflowUrl || null,
    competitors: record.competitors.filter(Boolean),
    billing_email: record.billingEmail || null,
    customer_contacts: record.customerContacts.filter(
      (contact) => contact.name || contact.role || contact.email || contact.phone,
    ),
    additional_info: record.additionalInfo || null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Name plus e-mail or phone. That contact replaces hoster and SMTP credentials. */
export function itContactCoversHosterAndSmtp(record: DtOnboardingRecord): boolean {
  if (!record.accessViaIt) return false;
  const name = record.itContact?.name?.trim() ?? "";
  const email = record.itContact?.email?.trim() ?? "";
  const phone = record.itContact?.phone?.trim() ?? "";
  if (!name) return false;
  if (email && EMAIL_RE.test(email)) return true;
  return Boolean(phone);
}

export function onboardingChecklist(
  record: DtOnboardingRecord,
  fileCount = 0,
): DtOnboardingChecklist {
  const competitorsFilled = record.competitors.filter((item) => item.trim()).length;
  const contactsFilled = record.customerContacts.some(
    (contact) => contact.name.trim() || contact.email.trim() || contact.phone.trim(),
  );
  const viaIt = itContactCoversHosterAndSmtp(record);
  return {
    mediaLink: fileCount > 0,
    hoster: viaIt || Boolean(record.hosterUser && record.hosterPassword),
    smtp:
      viaIt ||
      Boolean(record.smtpHost && record.smtpPort && record.smtpUsername && record.smtpPassword),
    cms: Boolean(record.cmsLoginUrl && record.cmsUser && record.cmsPassword),
    competitors: competitorsFilled > 0,
    billingEmail: /.+@.+\..+/.test(record.billingEmail),
    customerContacts: contactsFilled,
    files: fileCount,
  };
}

export function onboardingFilledCount(checklist: DtOnboardingChecklist): {
  filled: number;
  total: number;
} {
  const flags = [
    checklist.mediaLink,
    checklist.hoster,
    checklist.smtp,
    checklist.cms,
    checklist.competitors,
    checklist.billingEmail,
    checklist.customerContacts,
  ];
  return { filled: flags.filter(Boolean).length, total: flags.length };
}

export function validateOnboardingRecord(record: DtOnboardingRecord): string | null {
  if (record.billingEmail && !EMAIL_RE.test(record.billingEmail)) {
    return "Bitte eine gültige E-Mail-Adresse für die Buchhaltung angeben.";
  }
  for (const contact of record.customerContacts) {
    if (contact.email && !EMAIL_RE.test(contact.email)) {
      return "Bitte gültige E-Mail-Adressen bei den Ansprechpartnern angeben.";
    }
  }
  if (record.itContact.email && !EMAIL_RE.test(record.itContact.email)) {
    return "Bitte eine gültige E-Mail-Adresse beim IT-Kontakt angeben.";
  }
  if (!record.accessViaIt && record.smtpPort && !/^\d{2,5}$/.test(record.smtpPort)) {
    return "SMTP-Port bitte als Zahl angeben (z. B. 587).";
  }
  if (record.cmsLoginUrl) {
    const cmsError = validateHttpUrl(record.cmsLoginUrl, "CMS-Anmeldelink");
    if (cmsError) return cmsError;
  }
  if (record.passflowUrl) {
    const passflowError = validateHttpUrl(record.passflowUrl, "Passflow-Link");
    if (passflowError) return passflowError;
  }
  return null;
}

function validateHttpUrl(value: string, label: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${label} muss eine http(s)-URL sein.`;
    }
  } catch {
    return `${label} ist keine gültige URL.`;
  }
  return null;
}
