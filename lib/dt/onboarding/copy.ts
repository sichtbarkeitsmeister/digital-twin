/**
 * Customer onboarding copy and contacts shown in the DigitalTwin portal.
 * Passwords and hoster/CMS/SMTP secrets never go into LLM prompts.
 */

export const DT_ONBOARDING_MEDIA_INTRO =
  "Haben Sie vielleicht noch irgendwelche Bilder oder Videos, welche wir verwenden können?";

export const DT_ONBOARDING_MEDIA_ITEMS = [
  "Mitarbeiterfotos",
  "Fotos von Firmenfahrzeugen",
  "Fotos von Ihnen",
  "Fotos von Projekten von Ihnen",
  "sonstige Fotos",
  "Logo am besten als SVG-Datei",
] as const;

export const DT_ONBOARDING_SUPPORT_EMAIL = "support@sichtbarkeitsmeister.de";

export const DT_ONBOARDING_SWITCHBOARD_PHONE = "0211 - 97 26 53 60";

export type DtOnboardingContact = {
  name: string;
  role: string;
  email: string;
  extension: string;
  mobile?: string;
};

export const DT_ONBOARDING_CONTACTS: DtOnboardingContact[] = [
  {
    name: "André Petermann",
    role: "Ich leite Dich durch das Projekt und bin unter E-Mail ap@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 61) zu erreichen. Gerne kannst Du auch mobil unter 0179 - 2 11 03 59 Kontakt aufnehmen.",
    email: "ap@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 61",
    mobile: "0179 - 2 11 03 59",
  },
  {
    name: "Alina Lancman",
    role: "Sie ist Webdesignerin bei uns und unter al@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 63) zu erreichen. Sie erstellt Deine Webseite und passt diese auf Deine Änderungswünsche an.",
    email: "al@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 63",
  },
  {
    name: "Tamuna Sulakadze",
    role: "Sie überarbeitet die Firmenprofile und ist unter tamuna.sulakadze@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 67) erreichbar.",
    email: "tamuna.sulakadze@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 67",
  },
  {
    name: "Anja May",
    role: "Sie macht bei uns die SEO-Analysen. Sie ist unter a.may@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 66) erreichbar.",
    email: "a.may@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 66",
  },
  {
    name: "Tanja Krüger",
    role: "Sie macht bei uns ebenfalls die SEO-Analysen. Sie ist unter tanja.krueger@sichtbarkeitsmeister.de (Durchwahl 0211 - 97 26 53 65) erreichbar.",
    email: "tanja.krueger@sichtbarkeitsmeister.de",
    extension: "0211 - 97 26 53 65",
  },
];

export const DT_ONBOARDING_SUPPORT_NOTE =
  "Die wichtigste E-Mail ist die support@sichtbarkeitsmeister.de. Unter dieser E-Mail können Sie uns am besten immer anschreiben. Diese wird immer abgefragt. Bei den direkten E-Mails kann es passieren, dass gerade in der Urlaubszeit Ihre Aufgaben nicht abgearbeitet werden. Deshalb empfehle ich Ihnen alle E-Mail dort hinzuschicken.";

export const DT_ONBOARDING_PHONE_NOTE =
  "Telefonisch können Sie unsere Zentrale unter 0211 - 97 26 53 60 erreichen. Wenn unter der oben aufgeführten Durchwahl niemand ans Telefon geht, landen Sie automatisch in der Zentrale. Ihre Anliegen werden Sie aber in der Regel los.";

export const DT_ONBOARDING_MAX_COMPETITORS = 5;

export const DT_ONBOARDING_SMTP_PROTOCOLS = ["TLS", "STARTTLS", "SSL", "Kein"] as const;

export type DtOnboardingSmtpProtocol = (typeof DT_ONBOARDING_SMTP_PROTOCOLS)[number];

export const DT_ONBOARDING_MAX_FILES = 80;
export const DT_ONBOARDING_MAX_FILE_BYTES = 50 * 1024 * 1024;

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
};

export type DtOnboardingFileRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type DtOnboardingChecklist = {
  mediaLink: boolean;
  hoster: boolean;
  smtp: boolean;
  cms: boolean;
  competitors: boolean;
  billingEmail: boolean;
  files: number;
};

export function onboardingPublicPath(token: string): string {
  return `/onboarding/upload/${encodeURIComponent(token)}`;
}

export function onboardingDashboardPath(organisationId: string): string {
  return `/dashboard/onboarding?org=${encodeURIComponent(organisationId)}`;
}
