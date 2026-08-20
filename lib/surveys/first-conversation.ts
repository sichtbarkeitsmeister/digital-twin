/**
 * Erstgespräch / Kundendefinition — client-safe model.
 * Agency-led first conversation, persisted per organisation, then reused
 * when generating Fragebögen (Meeting-Briefing).
 */

import type { MeetingBriefing } from "@/lib/surveys/meeting-briefing";

export type FirstConversationFieldKey =
  | "conversationDate"
  | "agencyLead"
  | "ownerName"
  | "ownerRole"
  | "legalCompanyName"
  | "colloquialName"
  | "website"
  | "employeeCount"
  | "region"
  | "industry"
  | "services"
  | "usp"
  | "focus"
  | "targetGroup"
  | "wunschkundeLabel"
  | "competitors"
  | "goodCompetitors"
  | "onlineChannels"
  | "mandateGoals"
  | "pagesOrLinks"
  | "notes";

export type FirstConversationRecord = Record<FirstConversationFieldKey, string>;

export type FirstConversationField = {
  key: FirstConversationFieldKey;
  label: string;
  /** What the agency asks out loud. */
  ask: string;
  placeholder?: string;
  rows?: number;
  kind: "input" | "textarea";
};

export type FirstConversationSection = {
  id: string;
  title: string;
  description: string;
  fields: FirstConversationField[];
};

export const EMPTY_FIRST_CONVERSATION: FirstConversationRecord = {
  conversationDate: "",
  agencyLead: "",
  ownerName: "",
  ownerRole: "",
  legalCompanyName: "",
  colloquialName: "",
  website: "",
  employeeCount: "",
  region: "",
  industry: "",
  services: "",
  usp: "",
  focus: "",
  targetGroup: "",
  wunschkundeLabel: "",
  competitors: "",
  goodCompetitors: "",
  onlineChannels: "",
  mandateGoals: "",
  pagesOrLinks: "",
  notes: "",
};

export const FIRST_CONVERSATION_SECTIONS: FirstConversationSection[] = [
  {
    id: "frame",
    title: "Rahmen",
    description: "Kurz notieren, wer mit wem spricht — dann ins Gespräch gehen.",
    fields: [
      {
        key: "conversationDate",
        label: "Datum",
        ask: "Wann findet das Erstgespräch statt?",
        placeholder: "z. B. 20.08.2026",
        kind: "input",
      },
      {
        key: "agencyLead",
        label: "Gesprächsführung (Agentur)",
        ask: "Wer führt das Gespräch von Sichtbarkeitsmeister?",
        placeholder: "z. B. Vanessa",
        kind: "input",
      },
      {
        key: "ownerName",
        label: "Gegenüber — Name",
        ask: "Wie heißt die Person, mit der wir sprechen?",
        placeholder: "Vor- und Nachname",
        kind: "input",
      },
      {
        key: "ownerRole",
        label: "Gegenüber — Rolle",
        ask: "Welche Rolle hat diese Person in der Firma?",
        placeholder: "Inhaber, Geschäftsführung, Marketing, Assistenz…",
        kind: "input",
      },
    ],
  },
  {
    id: "company",
    title: "Kundendefinition — Unternehmen",
    description: "So, wie der Kunde die Firma selbst beschreibt.",
    fields: [
      {
        key: "legalCompanyName",
        label: "Offizieller Firmenname",
        ask: "Wie lautet der vollständige Name — so wie im Impressum oder Handelsregister?",
        placeholder: "z. B. Musterdruck GmbH",
        kind: "input",
      },
      {
        key: "colloquialName",
        label: "Alltagsname",
        ask: "Wie wird die Firma im Alltag genannt — von Kunden oder im Team?",
        placeholder: "Kurzform, Spitzname…",
        kind: "input",
      },
      {
        key: "website",
        label: "Website",
        ask: "Unter welcher Adresse ist die Website erreichbar?",
        placeholder: "https://…",
        kind: "input",
      },
      {
        key: "industry",
        label: "Branche",
        ask: "In welcher Branche ist die Firma unterwegs — in eigenen Worten?",
        placeholder: "z. B. Zahnarztpraxis, Druckerei, Steuerberatung",
        kind: "input",
      },
      {
        key: "region",
        label: "Sitz und Einzugsgebiet",
        ask: "Wo sitzt die Firma, und aus welcher Region kommen die meisten Kunden?",
        placeholder: "Ort, Kreis, Umkreis…",
        kind: "textarea",
        rows: 2,
      },
      {
        key: "employeeCount",
        label: "Teamgröße",
        ask: "Wie viele Personen gehören zum Team — grob reicht.",
        placeholder: "z. B. 8 Personen, 3 davon in der Beratung",
        kind: "input",
      },
    ],
  },
  {
    id: "offer",
    title: "Angebot und Positionierung",
    description: "Was verkauft wird und warum jemand genau hier kauft.",
    fields: [
      {
        key: "services",
        label: "Leistungen",
        ask: "Welche Leistungen oder Produkte werden aktuell angeboten?",
        placeholder: "Die wichtigsten Angebote, nicht die komplette Preisliste",
        kind: "textarea",
        rows: 3,
      },
      {
        key: "usp",
        label: "Was unterscheidet euch?",
        ask: "Was macht das Angebot besonders im Vergleich zu anderen in der Region?",
        placeholder: "Der Satz, den der Kunde selbst sagt — nicht Marketing-Floskeln",
        kind: "textarea",
        rows: 3,
      },
      {
        key: "focus",
        label: "Fokus / Schwerpunkt",
        ask: "Worauf soll die Sichtbarkeit vor allem liegen — welches Angebot, welche Keywords?",
        placeholder: "Schwerpunkt, Fokus-Keywords…",
        kind: "textarea",
        rows: 2,
      },
    ],
  },
  {
    id: "customer",
    title: "Wunschkunde",
    description: "Für wen die Fragebögen und der Avatar später gebaut werden.",
    fields: [
      {
        key: "wunschkundeLabel",
        label: "Name oder Kurzbezeichnung",
        ask: "Wie nennen wir den Wunschkunden intern — ein Name oder eine Kurzbezeichnung?",
        placeholder: "z. B. Julia Schröder, Praxisinhaberin",
        kind: "input",
      },
      {
        key: "targetGroup",
        label: "Wer ist der Wunschkunde?",
        ask: "Wer ist der ideale Kunde — und wer ausdrücklich nicht?",
        placeholder: "Branche, Situation, typisches Problem…",
        kind: "textarea",
        rows: 4,
      },
    ],
  },
  {
    id: "market",
    title: "Wettbewerb und Sichtbarkeit",
    description: "Wen der Kunde kennt, und wo die Firma heute auftaucht.",
    fields: [
      {
        key: "competitors",
        label: "Mitbewerber",
        ask: "Welche drei bis fünf Anbieter sind die wichtigsten Mitbewerber — und warum?",
        placeholder: "Name, Website, kurzer Grund",
        kind: "textarea",
        rows: 3,
      },
      {
        key: "goodCompetitors",
        label: "Gute Wettbewerber / Vorbilder",
        ask: "Wen respektiert ihr — oder an wem orientiert ihr euch?",
        placeholder: "Starke Anbieter, auch außerhalb der Region",
        kind: "textarea",
        rows: 2,
      },
      {
        key: "onlineChannels",
        label: "Kanäle heute",
        ask: "Welche Kanäle werden aktuell wirklich genutzt — Website, Google, Social, Newsletter?",
        placeholder: "Nur das, was aktiv betrieben wird",
        kind: "textarea",
        rows: 2,
      },
    ],
  },
  {
    id: "mandate",
    title: "Auftrag und Unterlagen",
    description: "Was nach dem Gespräch passieren soll, und was schon vorliegt.",
    fields: [
      {
        key: "mandateGoals",
        label: "Ziel des Mandats",
        ask: "Was soll in den nächsten Monaten besser werden — Anfragen, Auffindbarkeit, Wahrnehmung?",
        placeholder: "In den Worten des Kunden",
        kind: "textarea",
        rows: 3,
      },
      {
        key: "pagesOrLinks",
        label: "Genannte Seiten und Unterlagen",
        ask: "Welche Seiten, Flyer, PDFs oder Beispiele wurden genannt?",
        placeholder: "https://… oder Dateiname",
        kind: "textarea",
        rows: 3,
      },
      {
        key: "notes",
        label: "Weitere Notizen",
        ask: "Gibt es noch etwas Wichtiges, das in keine Schublade passt?",
        placeholder: "Labels helfen später (Region:, USP:, Fokuskeywords: …)",
        kind: "textarea",
        rows: 4,
      },
    ],
  },
];

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeFirstConversation(
  raw: unknown,
): FirstConversationRecord {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out = { ...EMPTY_FIRST_CONVERSATION };
  for (const key of Object.keys(EMPTY_FIRST_CONVERSATION) as FirstConversationFieldKey[]) {
    out[key] = trimOrEmpty(src[key]);
  }
  return out;
}

export function firstConversationHasContent(
  record: FirstConversationRecord | null | undefined,
): boolean {
  if (!record) return false;
  return Object.values(record).some((value) => value.trim().length > 0);
}

export function firstConversationFilledCount(
  record: FirstConversationRecord | null | undefined,
): { filled: number; total: number } {
  const total = Object.keys(EMPTY_FIRST_CONVERSATION).length;
  if (!record) return { filled: 0, total };
  const filled = Object.values(record).filter((value) => value.trim().length > 0).length;
  return { filled, total };
}

/**
 * Extra labeled notes that are not first-class MeetingBriefing fields.
 * Parsed later by meeting-briefing label rules / unknown-label extras.
 */
function leftoverLabeledNotes(record: FirstConversationRecord): string {
  const parts: string[] = [];
  const push = (label: string, value: string) => {
    const t = value.trim();
    if (t) parts.push(`${label}:\n${t}`);
  };
  push("Rolle Gesprächspartner", record.ownerRole);
  push("Alltagsname", record.colloquialName);
  push("Branche", record.industry);
  push("Online-Kanäle", record.onlineChannels);
  push("Wunschkunde", record.wunschkundeLabel);
  push("Ziel des Mandats", record.mandateGoals);
  push("Gesprächsführung", record.agencyLead);
  push("Gesprächsdatum", record.conversationDate);
  if (record.notes.trim()) parts.push(record.notes.trim());
  return parts.join("\n\n");
}

/** Map Kundendefinition → Meeting-Briefing for Fragebogen-Prefill. */
export function firstConversationToMeetingBriefing(
  record: FirstConversationRecord,
): MeetingBriefing {
  const notes = leftoverLabeledNotes(record);
  return {
    legalCompanyName: record.legalCompanyName || null,
    ownerName: record.ownerName || null,
    competitors: record.competitors || null,
    goodCompetitors: record.goodCompetitors || null,
    pagesOrLinks: record.pagesOrLinks || null,
    notes: notes || null,
    focus: record.focus || null,
    services: record.services || null,
    usp: record.usp || null,
    region: record.region || null,
    targetGroup: record.targetGroup || null,
    employeeCount: record.employeeCount || null,
    website: record.website || null,
  };
}

export function firstConversationSummaryLines(
  record: FirstConversationRecord,
): string[] {
  const lines: string[] = [];
  const push = (label: string, value: string) => {
    const t = value.trim();
    if (t) lines.push(`${label}: ${t.replace(/\s+/g, " ").slice(0, 160)}`);
  };
  push("Firma", record.legalCompanyName);
  push("Gesprächspartner", [record.ownerName, record.ownerRole].filter(Boolean).join(", "));
  push("Website", record.website);
  push("Region", record.region);
  push("Wunschkunde", record.wunschkundeLabel || record.targetGroup);
  push("Fokus", record.focus);
  return lines;
}
