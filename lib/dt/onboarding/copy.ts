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

export type DtOnboardingContact = {
  name: string;
  shortRole: string;
  role: string;
  email: string;
  extension: string;
  mobile?: string;
  photoSrc?: string;
};

export const DT_ONBOARDING_CONTACTS: DtOnboardingContact[] = [
  {
    name: "André Petermann",
    shortRole: "Projektleitung",
    role: "Projektleitung. Erreichbar per E-Mail ap@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 61) sowie mobil unter 0179 - 2 11 03 59.",
    email: "ap@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 61",
    mobile: "0179 - 2 11 03 59",
  },
  {
    name: "Alina Lancman",
    shortRole: "Webdesign",
    role: "Webdesignerin bei Sichtbarkeitsmeister. Erreichbar unter al@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 63). Zuständig für die Webseite und Änderungswünsche.",
    email: "al@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 63",
  },
  {
    name: "Tamuna Sulakadze",
    shortRole: "Firmenprofile",
    role: "Zuständig für die Überarbeitung der Firmenprofile. Erreichbar unter tamuna.sulakadze@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 67).",
    email: "tamuna.sulakadze@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 67",
  },
  {
    name: "Anja May",
    shortRole: "SEO",
    role: "Zuständig für SEO-Analysen. Erreichbar unter a.may@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 66).",
    email: "a.may@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 66",
  },
  {
    name: "Tanja Krüger",
    shortRole: "SEO",
    role: "Ebenfalls zuständig für SEO-Analysen. Erreichbar unter tanja.krueger@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 65).",
    email: "tanja.krueger@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 65",
  },
];

export const DT_ONBOARDING_SUPPORT_NOTE =
  "Die zentrale E-Mail-Adresse lautet support@sichtbarkeitsmeister.de. Anfragen an diese Adresse werden immer abgefragt. Direkte E-Mails können in der Urlaubszeit unbeantwortet bleiben. Deshalb alle E-Mails an diese Adresse senden.";

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
