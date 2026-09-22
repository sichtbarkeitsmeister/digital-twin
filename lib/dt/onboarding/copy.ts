/**
 * Customer onboarding copy and contacts shown in the DigitalTwin portal.
 * Passwords and hoster/CMS/SMTP secrets never go into LLM prompts.
 */

export const DT_ONBOARDING_MEDIA_INTRO =
  "Bitte Bilder oder Videos bereitstellen, die verwendet werden können:";

export const DT_ONBOARDING_MEDIA_ITEMS = [
  "Mitarbeiterfotos",
  "Fotos von Firmenfahrzeugen",
  "Personenfotos",
  "Projektfotos",
  "sonstige Fotos",
  "Logo am besten als SVG-Datei",
] as const;

export const DT_ONBOARDING_SUPPORT_EMAIL = "support@sichtbarkeitsmeister.de";

export const DT_ONBOARDING_SWITCHBOARD_PHONE = "0211 - 97 26 53 60";

export const DT_ONBOARDING_PASSFLOW_URL = "https://passflow.de/";

export const DT_ONBOARDING_PASSFLOW_TITLE = "Passflow als Notlösung";

export const DT_ONBOARDING_PASSFLOW_INTRO =
  "Wenn Zugangsdaten nicht in den Feldern oben hinterlegt werden können. Verschlüsselt und zeitlich begrenzt.";

export const DT_ONBOARDING_PASSFLOW_STEPS = [
  "Passflow öffnen.",
  "Die Zugänge dort anlegen.",
  "Den Passflow-Link hier einfügen und Onboarding speichern.",
] as const;

export const DT_ONBOARDING_PASSFLOW_FALLBACK =
  "Das Projektteam erhält eine Info und holt den Link ab, bevor er abläuft.";

export type DtOnboardingContact = {
  name: string;
  shortRole: string;
  role: string;
  email: string;
  extension: string;
  mobile?: string;
  photoSrc?: string;
};

/**
 * SBKM project contacts shown on /dashboard/ansprechpartner.
 * Roles follow the public booking page (termin-buchen) plus DigitalTwin.
 * There is no admin UI yet — change assignments here in code.
 */
export const DT_ONBOARDING_CONTACTS: DtOnboardingContact[] = [
  {
    name: "Tanja Krüger",
    shortRole: "SEO, GEO, DigitalTwin",
    role: "SEO, GEO (KI-Sichtbarkeit) und DigitalTwin. Erste Ansprechpartnerin für DigitalTwin.",
    email: "tanja.krueger@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 65",
  },
  {
    name: "André Petermann",
    shortRole: "Geschäftsführung",
    role: "Geschäftsführung. Erstgespräch und Strategie.",
    email: "ap@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 61",
    mobile: "0179 - 2 11 03 59",
  },
  {
    name: "Alina Lancman",
    shortRole: "Webdesign",
    role: "Webdesign. Zuständig für die Webseite und Änderungswünsche.",
    email: "al@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 63",
  },
  {
    name: "Anja May",
    shortRole: "SEO und KI",
    role: "SEO und KI-Strategie.",
    email: "a.may@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 66",
  },
  {
    name: "Tami Sulakadze",
    shortRole: "Profilmanagement",
    role: "Profilmanagement (Local SEO).",
    email: "tamuna.sulakadze@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 67",
  },
  {
    name: "Support",
    shortRole: "Alle weiteren Fragen",
    role: "Kann für alle weiteren Fragen genutzt werden oder wenn jemand in Urlaub ist.",
    email: "support@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 60",
  },
];

export const DT_ONBOARDING_SUPPORT_NOTE =
  "support@sichtbarkeitsmeister.de kann für alle weiteren Fragen genutzt werden oder wenn jemand in Urlaub ist.";

export const DT_ONBOARDING_PHONE_NOTE =
  "Telefonisch ist die Zentrale unter 0211 - 97 26 53 60 erreichbar. Wenn unter der oben aufgeführten Durchwahl niemand ans Telefon geht, erfolgt die Weiterleitung automatisch in die Zentrale. Anliegen werden in der Regel dort angenommen.";

export const DT_ONBOARDING_MAX_COMPETITORS = 5;
export const DT_ONBOARDING_MAX_CUSTOMER_CONTACTS = 5;
export const DT_ONBOARDING_ADDITIONAL_INFO_MAX = 4000;

export const DT_ONBOARDING_SMTP_PROTOCOLS = ["TLS", "STARTTLS", "SSL", "Kein"] as const;

export type DtOnboardingSmtpProtocol = (typeof DT_ONBOARDING_SMTP_PROTOCOLS)[number];

export const DT_ONBOARDING_MAX_FILES = 80;
export const DT_ONBOARDING_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type DtOnboardingCustomerContact = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

export const EMPTY_CUSTOMER_CONTACT: DtOnboardingCustomerContact = {
  name: "",
  role: "",
  email: "",
  phone: "",
};

export type DtOnboardingRecord = {
  uploadToken: string;
  uploadPassword: string;
  hosterUser: string;
  hosterPassword: string;
  smtpHost: string;
  smtpPort: string;
  smtpProtocol: string;
  smtpUsername: string;
  smtpPassword: string;
  cmsLoginUrl: string;
  cmsUser: string;
  cmsPassword: string;
  passflowUrl: string;
  competitors: string[];
  billingEmail: string;
  customerContacts: DtOnboardingCustomerContact[];
  additionalInfo: string;
};

export const EMPTY_ONBOARDING_RECORD: DtOnboardingRecord = {
  uploadToken: "",
  uploadPassword: "",
  hosterUser: "",
  hosterPassword: "",
  smtpHost: "",
  smtpPort: "",
  smtpProtocol: "TLS",
  smtpUsername: "",
  smtpPassword: "",
  cmsLoginUrl: "",
  cmsUser: "",
  cmsPassword: "",
  passflowUrl: "",
  competitors: ["", "", "", "", ""],
  billingEmail: "",
  customerContacts: Array.from(
    { length: DT_ONBOARDING_MAX_CUSTOMER_CONTACTS },
    () => ({ ...EMPTY_CUSTOMER_CONTACT }),
  ),
  additionalInfo: "",
};

export type DtOnboardingFileRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  previewUrl?: string | null;
};

export type DtOnboardingChecklist = {
  mediaLink: boolean;
  hoster: boolean;
  smtp: boolean;
  cms: boolean;
  competitors: boolean;
  billingEmail: boolean;
  customerContacts: boolean;
  files: number;
};

export function onboardingPublicPath(token: string): string {
  return `/onboarding/upload/${encodeURIComponent(token)}`;
}

export function onboardingDashboardPath(organisationId: string): string {
  return `/dashboard/onboarding?org=${encodeURIComponent(organisationId)}`;
}
