/**
 * Erstgespräch / Kundendefinition — client-safe model.
 * Agency-led first conversation, persisted per organisation, then reused
 * when generating Fragebögen (Meeting-Briefing).
 *
 * Three conversation kinds (Arztpraxis, Kanzlei, Weitere) share the same
 * stored keys; only spoken asks and labels change.
 */

import {
  extractLabeledSections,
  type MeetingBriefing,
} from "@/lib/surveys/meeting-briefing";

export type FirstConversationKind = "praxis" | "kanzlei" | "weitere";

export type FirstConversationFieldKey =
  | "conversationKind"
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
  | "currentStatus"
  | "bookingPath"
  | "services"
  | "usp"
  | "focus"
  | "targetGroup"
  | "unattractiveCustomers"
  | "keepOthers"
  | "wunschkundeLabel"
  | "competitors"
  | "goodCompetitors"
  | "onlineChannels"
  | "websiteIssues"
  | "mandateGoals"
  | "futurePlans"
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
  conversationKind: "",
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
  currentStatus: "",
  bookingPath: "",
  services: "",
  usp: "",
  focus: "",
  targetGroup: "",
  unattractiveCustomers: "",
  keepOthers: "",
  wunschkundeLabel: "",
  competitors: "",
  goodCompetitors: "",
  onlineChannels: "",
  websiteIssues: "",
  mandateGoals: "",
  futurePlans: "",
  pagesOrLinks: "",
  notes: "",
};

/** Hidden in the form: kind is chosen via tabs; goodCompetitors kept for old records. */
export const FIRST_CONVERSATION_HIDDEN_KEYS: ReadonlySet<FirstConversationFieldKey> =
  new Set(["conversationKind", "goodCompetitors"]);

export const FIRST_CONVERSATION_KIND_TABS: ReadonlyArray<{
  id: FirstConversationKind;
  label: string;
  hint: string;
}> = [
  {
    id: "praxis",
    label: "Arztpraxis",
    hint: "Patienten, Praxis, Wunschpatient",
  },
  {
    id: "kanzlei",
    label: "Kanzlei",
    hint: "Mandanten, Kanzlei, Wunschmandant",
  },
  {
    id: "weitere",
    label: "Weitere",
    hint: "Kunden, Firma, Wunschkunde",
  },
];

type Vocab = {
  org: string;
  orgGen: string;
  customer: string;
  customerPlural: string;
  wish: string;
  wishPlural: string;
  legalNameLabel: string;
  legalNamePlaceholder: string;
};

function vocabFor(kind: FirstConversationKind): Vocab {
  if (kind === "praxis") {
    return {
      org: "Praxis",
      orgGen: "der Praxis",
      customer: "Patient",
      customerPlural: "Patienten",
      wish: "Wunschpatient",
      wishPlural: "Wunschpatienten",
      legalNameLabel: "Praxisname",
      legalNamePlaceholder: "z. B. Haut- und Laserpraxis Dr. Muster",
    };
  }
  if (kind === "kanzlei") {
    return {
      org: "Kanzlei",
      orgGen: "der Kanzlei",
      customer: "Mandant",
      customerPlural: "Mandanten",
      wish: "Wunschmandant",
      wishPlural: "Wunschmandanten",
      legalNameLabel: "Kanzleiname",
      legalNamePlaceholder: "z. B. Kanzlei Muster & Partner",
    };
  }
  return {
    org: "Firma",
    orgGen: "der Firma",
    customer: "Kunde",
    customerPlural: "Kunden",
    wish: "Wunschkunde",
    wishPlural: "Wunschkunden",
    legalNameLabel: "Firmenname",
    legalNamePlaceholder: "z. B. Musterdruck GmbH",
  };
}

function field(
  key: FirstConversationFieldKey,
  label: string,
  ask: string,
  opts?: {
    placeholder?: string;
    kind?: "input" | "textarea";
    rows?: number;
  },
): FirstConversationField {
  return {
    key,
    label,
    ask,
    placeholder: opts?.placeholder,
    kind: opts?.kind ?? "textarea",
    rows: opts?.rows,
  };
}

/**
 * Spoken conversation flow:
 * 1. Rahmen  2. Aktueller Stand  3. Leistungen und Fokus
 * 4. Wunschkunden  5. Sichtbarkeit  6. Zukunft
 */
export function firstConversationSectionsForKind(
  kind: FirstConversationKind,
): FirstConversationSection[] {
  const v = vocabFor(kind);
  const industryField =
    kind === "weitere"
      ? [
          field(
            "industry",
            "Branche",
            "In welcher Branche ist die Firma unterwegs — in eigenen Worten?",
            {
              placeholder: "z. B. Druckerei, Steuerberatung, Handwerk",
              kind: "input",
            },
          ),
        ]
      : [];

  return [
    {
      id: "frame",
      title: "Rahmen",
      description: `Kurz notieren, wer mit wem spricht — dann ins Gespräch über die ${v.org}.`,
      fields: [
        field("conversationDate", "Datum", "Wann findet das Gespräch statt?", {
          placeholder: "z. B. 20.08.2026",
          kind: "input",
        }),
        field(
          "agencyLead",
          "Gesprächsführung (Agentur)",
          "Wer führt das Gespräch von Sichtbarkeitsmeister?",
          { placeholder: "z. B. Vanessa", kind: "input" },
        ),
        field(
          "ownerName",
          "Gegenüber — Name",
          "Wie heißt die Person, mit der wir sprechen?",
          { placeholder: "Vor- und Nachname", kind: "input" },
        ),
        field(
          "ownerRole",
          "Gegenüber — Rolle",
          `Welche Rolle hat diese Person in ${v.orgGen}?`,
          {
            placeholder:
              kind === "praxis"
                ? "Ärztin, Inhaber, Praxisleitung…"
                : kind === "kanzlei"
                  ? "Partnerin, Anwalt, Kanzleileitung…"
                  : "Inhaber, Geschäftsführung, Marketing…",
            kind: "input",
          },
        ),
        field(
          "legalCompanyName",
          v.legalNameLabel,
          kind === "praxis"
            ? "Wie lautet der Name — so wie er auf der Website und im Alltag stehen soll?"
            : kind === "kanzlei"
              ? "Wie lautet der Kanzleiname — so wie im Impressum oder auf dem Briefbogen?"
              : "Wie lautet der vollständige Name — so wie im Impressum oder Handelsregister?",
          { placeholder: v.legalNamePlaceholder, kind: "input" },
        ),
        field(
          "colloquialName",
          "Alltagsname",
          `Wie wird die ${v.org} im Alltag genannt — und stimmt das mit der Website überein?`,
          { placeholder: "Kurzform, alter Name, Spitzname…", kind: "input" },
        ),
        field("website", "Website", "Unter welcher Adresse ist die Website erreichbar?", {
          placeholder: "https://…",
          kind: "input",
        }),
        ...industryField,
        field(
          "region",
          "Standort und Einzugsgebiet",
          `Wo sitzt die ${v.org}, und aus welcher Region kommen die meisten ${v.customerPlural}? Weitere Standorte geplant?`,
          {
            placeholder: "Ort, Umkreis, ein Standort oder mehrere…",
            rows: 2,
          },
        ),
        field(
          "employeeCount",
          "Team",
          "Wer gehört zum Team — grob reicht. Gibt es zusätzliche Angebote im Haus, die auf der Website fehlen?",
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Ärztin, Rezeption, Kosmetikerin"
                : kind === "kanzlei"
                  ? "z. B. 4 Anwälte, 2 Fachangestellte"
                  : "z. B. 8 Personen, 3 in der Beratung",
            kind: "input",
          },
        ),
      ],
    },
    {
      id: "status",
      title: "Aktueller Stand",
      description: `Wie es gerade läuft — bevor es um Wunsch${v.customerPlural.toLowerCase()} und Pläne geht.`,
      fields: [
        field(
          "currentStatus",
          "Wie läuft es gerade?",
          `Wie läuft die ${v.org} aktuell? Mix, was gut läuft, wo es hakt.`,
          {
            placeholder:
              kind === "praxis"
                ? "z. B. läuft gut, Mix Privat/Selbstzahler, Wunsch mehr Stamm-Patienten"
                : kind === "kanzlei"
                  ? "z. B. Mandate voll, Engpass bei Sichtbarkeit, Wunsch klarere Positionierung"
                  : "z. B. Auftragslage, was gut läuft, wo es hakt",
            rows: 4,
          },
        ),
        field(
          "bookingPath",
          kind === "praxis"
            ? "Wie kommen Patienten rein?"
            : kind === "kanzlei"
              ? "Wie kommen Mandate rein?"
              : "Wie kommen Anfragen rein?",
          kind === "praxis"
            ? "Wie kommen Patienten zu einem Termin — Telefon, Doctolib, Website, Empfehlung? Was ist an der Rezeption noch offen?"
            : kind === "kanzlei"
              ? "Wie kommen Mandate zustande — Empfehlung, Website, Anruf, Portal? Was ist am Empfang noch offen?"
              : "Wie kommen Anfragen zustande — Anruf, Website, Empfehlung, Anzeige?",
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Doctolib und Telefon, Rezeption noch in Arbeit"
                : "Nur der Weg, der wirklich genutzt wird",
            rows: 3,
          },
        ),
        field(
          "onlineChannels",
          "Kanäle heute",
          "Welche Kanäle werden aktuell wirklich genutzt — Website, Google, Social, Newsletter?",
          { placeholder: "Nur das, was aktiv betrieben wird", rows: 2 },
        ),
        field(
          "websiteIssues",
          "Was am Auftritt hakt",
          "Was an Website, Name oder Inhalten stimmt noch nicht — oder soll als Nächstes geändert werden?",
          {
            placeholder: "z. B. alter Name auf der Website, fehlende Leistungen, unklare Menüpunkte",
            rows: 3,
          },
        ),
      ],
    },
    {
      id: "offer",
      title: "Leistungen und Fokus",
      description: "Was heute angeboten wird, und worauf die Sichtbarkeit liegen soll.",
      fields: [
        field(
          "services",
          "Leistungen heute",
          `Welche Leistungen stehen aktuell auf der Karte — die wichtigsten, nicht die komplette Liste.`,
          {
            placeholder: "Die Angebote, die wirklich nachgefragt werden",
            rows: 4,
          },
        ),
        field(
          "focus",
          "Worauf spezialisieren?",
          `Worauf soll der Schwerpunkt liegen — welche Leistungen sollen wachsen, welche eher nicht in den Vordergrund?`,
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Laser und größere Eingriffe, nicht die kleine Einzelleistung"
                : kind === "kanzlei"
                  ? "z. B. Arbeitsrecht und Gesellschaftsrecht, nicht jedes Mandat gleich"
                  : "Schwerpunkt, Fokus-Themen…",
            rows: 3,
          },
        ),
        field(
          "usp",
          "Was unterscheidet",
          `Was macht die ${v.org} besonders — der Satz, der im Gespräch selbst fällt, keine Marketing-Floskel.`,
          {
            placeholder: `Expertise, Art der Arbeit, was ${v.customerPlural} schätzen`,
            rows: 3,
          },
        ),
        field(
          "mandateGoals",
          "Was soll besser werden?",
          "Was soll in den nächsten Monaten besser werden — Anfragen, Auffindbarkeit, Wahrnehmung, die richtigen Anfragen?",
          { placeholder: "In den Worten aus dem Gespräch", rows: 3 },
        ),
      ],
    },
    {
      id: "customers",
      title: v.wishPlural,
      description: `Für wen die Fragebögen und der Avatar später gebaut werden. Fokus heißt nicht Ablehnung.`,
      fields: [
        field(
          "targetGroup",
          `Welche ${v.customerPlural} sind am liebsten?`,
          `Welche ${v.customerPlural} laufen gut — regelmäßig, passend, wenig Reibung?`,
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Privatpatienten, die regelmäßig zur Vorsorge kommen und etwas dazubuchen"
                : kind === "kanzlei"
                  ? "z. B. Unternehmer mit laufendem Beratungsbedarf, nicht das einmalige Kleinstmandat"
                  : "Branche, Situation, typisches Anliegen…",
            rows: 4,
          },
        ),
        field(
          "unattractiveCustomers",
          `Welche ${v.customerPlural} sind eher unattraktiv?`,
          `Wer kostet viel und bringt wenig — und soll deshalb nicht die Werbung bestimmen?`,
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Selbstzahler mit einmaliger kleiner Leistung, ohne Wiederkehr"
                : "Kurz, ohne Wertung im Gespräch — nur für die Ausrichtung",
            rows: 3,
          },
        ),
        field(
          "keepOthers",
          "Andere bleiben willkommen?",
          `Heißt der Fokus auf ${v.wishPlural}, dass andere ${v.customerPlural} abgelehnt werden — oder bleibt die Entscheidung im Einzelfall?`,
          {
            placeholder: `Meist: Fokus nur für Website und Werbung — Einzelfall bleibt bei der ${v.org}`,
            rows: 2,
          },
        ),
        field(
          "wunschkundeLabel",
          `Ein bis zwei ${v.wish}-Typen`,
          `Wie heißen die ein oder zwei ${v.wish}-Typen intern — Kurzname reicht, Details kommen im Fragebogen.`,
          {
            placeholder:
              kind === "praxis"
                ? "z. B. Privatpatient mit Vorsorge-Anker / Laser-Interessent"
                : kind === "kanzlei"
                  ? "z. B. Mittelstands-Geschäftsführer / Erbrecht-Familie"
                  : "z. B. Julia Schröder, Praxisinhaberin",
            kind: "input",
          },
        ),
      ],
    },
    {
      id: "visibility",
      title: "Sichtbarkeit",
      description: "Wo die Firma heute auftaucht, und wen sie als Wettbewerb kennt.",
      fields: [
        field(
          "competitors",
          "Wettbewerb",
          `Welche Anbieter kennt die ${v.org} als Mitbewerber — und wen als Orientierung oder Vorbild, auch außerhalb der Region? Name, warum, reicht.`,
          {
            placeholder: "Name, Website, kurzer Grund — Wettbewerb und Vorbilder in einem",
            rows: 4,
          },
        ),
      ],
    },
    {
      id: "future",
      title: "Zukunft",
      description: "Was als Nächstes geplant ist, und was noch nachgeliefert wird.",
      fields: [
        field(
          "futurePlans",
          "Was ist geplant?",
          `Was ist für die nächsten Monate geplant — neue Leistungen, Standort, Team, Inhalte? Welche Unterlagen kommen noch?`,
          {
            placeholder: "Pläne, Material das nachkommt, offene Punkte für uns",
            rows: 4,
          },
        ),
        field(
          "pagesOrLinks",
          "Genannte Seiten und Unterlagen",
          "Welche Seiten, Flyer, PDFs oder Beispiele wurden genannt?",
          { placeholder: "https://… oder Dateiname", rows: 2 },
        ),
        field(
          "notes",
          "Weitere Notizen",
          "Gibt es noch etwas Wichtiges, das in keine Schublade passt?",
          {
            placeholder: "Ton im Gespräch, offene Zugänge, sonstige Hinweise",
            rows: 4,
          },
        ),
      ],
    },
  ];
}

/** Default sections (Arztpraxis) — tests and callers without a kind. */
export const FIRST_CONVERSATION_SECTIONS: FirstConversationSection[] =
  firstConversationSectionsForKind("praxis");

export function parseFirstConversationKind(value: unknown): FirstConversationKind {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    v === "kanzlei" ||
    v === "anwaltskanzlei" ||
    v === "rechtsanwalt" ||
    v === "rechtsanwältin"
  ) {
    return "kanzlei";
  }
  if (v === "weitere" || v === "sonstige" || v === "other" || v === "firma") {
    return "weitere";
  }
  if (v === "praxis" || v === "arztpraxis" || v === "zahnarztpraxis") {
    return "praxis";
  }
  return "praxis";
}

function inferKindFromRecord(
  src: Record<string, unknown>,
  industry: string,
): FirstConversationKind {
  const explicit = typeof src.conversationKind === "string" ? src.conversationKind.trim() : "";
  if (explicit) return parseFirstConversationKind(explicit);
  const ind = industry.toLowerCase();
  if (/kanzlei|rechtsanw|anwalt/.test(ind)) return "kanzlei";
  if (/arztpraxis|zahnarzt|dermatolog|hautarzt|\bpraxis\b/.test(ind)) return "praxis";
  if (ind.trim()) return "weitere";
  return "praxis";
}

export function firstConversationKindOf(
  record: FirstConversationRecord | null | undefined,
): FirstConversationKind {
  if (!record) return "praxis";
  return inferKindFromRecord(record, record.industry);
}

/** Switch tab: keep answers, persist kind. Industry stays unless empty. */
export function applyFirstConversationKind(
  record: FirstConversationRecord,
  kind: FirstConversationKind,
): FirstConversationRecord {
  return { ...record, conversationKind: kind };
}

export function firstConversationVisibleKeys(
  kind: FirstConversationKind,
): FirstConversationFieldKey[] {
  return firstConversationSectionsForKind(kind).flatMap((section) =>
    section.fields.map((item) => item.key),
  );
}

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
    if (key === "conversationKind") continue;
    out[key] = trimOrEmpty(src[key]);
  }
  const explicit = trimOrEmpty(src.conversationKind);
  out.conversationKind = explicit ? parseFirstConversationKind(explicit) : "";
  return out;
}

export function prepareFirstConversationForSave(
  record: FirstConversationRecord,
): FirstConversationRecord {
  const next = normalizeFirstConversation(record);
  const kind = firstConversationKindOf(next);
  next.conversationKind = kind;
  const hasOther = (
    Object.keys(EMPTY_FIRST_CONVERSATION) as FirstConversationFieldKey[]
  ).some(
    (key) =>
      key !== "conversationKind" &&
      key !== "industry" &&
      key !== "goodCompetitors" &&
      next[key].trim().length > 0,
  );
  if (hasOther) {
    if (kind === "praxis" && !next.industry.trim()) next.industry = "Arztpraxis";
    if (kind === "kanzlei" && !next.industry.trim()) next.industry = "Kanzlei";
  }
  return next;
}

function countableKeys(record: FirstConversationRecord): FirstConversationFieldKey[] {
  return (Object.keys(EMPTY_FIRST_CONVERSATION) as FirstConversationFieldKey[]).filter(
    (key) => key !== "conversationKind",
  );
}

export function firstConversationHasContent(
  record: FirstConversationRecord | null | undefined,
): boolean {
  if (!record) return false;
  return countableKeys(record).some((key) => record[key].trim().length > 0);
}

export function firstConversationFilledCount(
  record: FirstConversationRecord | null | undefined,
): { filled: number; total: number } {
  const kind = firstConversationKindOf(record ?? EMPTY_FIRST_CONVERSATION);
  const keys = firstConversationVisibleKeys(kind);
  const total = keys.length;
  if (!record) return { filled: 0, total };
  const filled = keys.filter((key) => record[key].trim().length > 0).length;
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
  push("Aktueller Stand", record.currentStatus);
  push("Buchungsweg", record.bookingPath);
  push("Online-Kanäle", record.onlineChannels);
  push("Website und Auftritt", record.websiteIssues);
  push("Weniger passende Kunden", record.unattractiveCustomers);
  push("Andere Kunden bleiben", record.keepOthers);
  push("Wunschkunde", record.wunschkundeLabel);
  push("Ziel des Mandats", record.mandateGoals);
  push("Zukunft und nächste Schritte", record.futurePlans);
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
  const competitors = [record.competitors, record.goodCompetitors]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    legalCompanyName: record.legalCompanyName || null,
    ownerName: record.ownerName || null,
    competitors: competitors || null,
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
  const kind = firstConversationKindOf(record);
  const tab = FIRST_CONVERSATION_KIND_TABS.find((item) => item.id === kind);
  if (tab) lines.push(`Typ: ${tab.label}`);
  const push = (label: string, value: string) => {
    const t = value.trim();
    if (t) lines.push(`${label}: ${t.replace(/\s+/g, " ").slice(0, 160)}`);
  };
  push("Name", record.legalCompanyName);
  push("Gesprächspartner", [record.ownerName, record.ownerRole].filter(Boolean).join(", "));
  push("Website", record.website);
  push("Region", record.region);
  push("Stand", record.currentStatus);
  push("Fokus", record.focus);
  push("Wunschkunde", record.wunschkundeLabel || record.targetGroup);
  push("Zukunft", record.futurePlans);
  return lines;
}

export const FIRST_CONVERSATION_FILE_ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const FIRST_CONVERSATION_MAX_FILES = 8;
export const FIRST_CONVERSATION_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type FirstConversationFileMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hasText: boolean;
  createdAt: string;
};

const DOCUMENT_LABEL_TO_KEY: Array<[RegExp, FirstConversationFieldKey]> = [
  [/^(?:firmenname|unternehmensname|offizieller\s+name|name\s+der\s+firma|praxisname|kanzleiname)$/i, "legalCompanyName"],
  [/^(?:alltagsname|kurzname|spitzname)$/i, "colloquialName"],
  [/^(?:website|webseite|homepage|domain)$/i, "website"],
  [/^(?:inhaber(?:in)?|geschäftsführer(?:in)?|ansprechpartner(?:in)?|gründer(?:in)?)$/i, "ownerName"],
  [/^(?:rolle(?:\s+gespr(?:ä|ae)chspartner)?)$/i, "ownerRole"],
  [/^(?:mitarbeiter(?:zahl|innen)?|teamgr(?:ö|oe)sse|beschäftigte|personen|team)$/i, "employeeCount"],
  [/^(?:region|regionen|einzugsgebiet|standort|marktgebiet)$/i, "region"],
  [/^(?:branche|gewerbe)$/i, "industry"],
  [/^(?:aktueller\s+stand|status\s*quo|wie\s+l(?:ä|ae)uft)$/i, "currentStatus"],
  [/^(?:buchungsweg|wie\s+kommen|termine|doctolib)$/i, "bookingPath"],
  [/^(?:leistungen|services|angebot|angebote|produkte)$/i, "services"],
  [/^(?:usp|alleinstellung|differenzierung)$/i, "usp"],
  [/^(?:fokus|schwerpunkt|fokuskeywords?|keywords?|spezialisierung)$/i, "focus"],
  [/^(?:zielgruppe|kundengruppe)$/i, "targetGroup"],
  [/^(?:unattraktiv|weniger\s+passende|eher\s+nicht)$/i, "unattractiveCustomers"],
  [/^(?:andere\s+kunden\s+bleiben|ausschlussfrage)$/i, "keepOthers"],
  [/^(?:wunschkunde|wunschpatient|wunschmandant|avatar)$/i, "wunschkundeLabel"],
  [/^(?:mitbewerber|wettbewerber|wettbewerb|konkurrenz|vorbilder)$/i, "competitors"],
  [/^(?:gute\s+wettbewerber)$/i, "goodCompetitors"],
  [/^(?:online[\s_-]?kan(?:ä|ae)le|kan(?:ä|ae)le)$/i, "onlineChannels"],
  [/^(?:website\s+und\s+auftritt|website[\s_-]?issues?|men(?:ü|ue))$/i, "websiteIssues"],
  [/^(?:ziel\s+des\s+mandats|mandat|auftrag)$/i, "mandateGoals"],
  [/^(?:zukunft|n(?:ä|ae)chste\s+schritte|geplant)$/i, "futurePlans"],
  [/^(?:seiten|links|landingpages?|urls?)$/i, "pagesOrLinks"],
];

/**
 * Fill empty Erstgespräch fields from labeled document text.
 * Existing values win — documents only fill gaps.
 */
export function applyDocumentTextToFirstConversation(
  record: FirstConversationRecord,
  documentText: string,
): { record: FirstConversationRecord; filledKeys: FirstConversationFieldKey[] } {
  const next = { ...record };
  const filledKeys: FirstConversationFieldKey[] = [];
  const leftover: string[] = [];

  for (const section of extractLabeledSections(documentText)) {
    if (section.label === "_raw") {
      if (section.value.trim().length >= 8) leftover.push(section.value.trim());
      continue;
    }
    const key = DOCUMENT_LABEL_TO_KEY.find(([re]) => re.test(section.label.trim()))?.[1];
    if (!key) {
      leftover.push(`${section.label}: ${section.value}`.trim());
      continue;
    }
    if (!next[key].trim() && section.value.trim()) {
      next[key] = section.value.trim().slice(0, 8000);
      filledKeys.push(key);
    }
  }

  if (!next.notes.trim() && leftover.length) {
    next.notes = leftover.join("\n\n").slice(0, 8000);
    filledKeys.push("notes");
  } else if (leftover.length && leftover.some((p) => !next.notes.includes(p.slice(0, 40)))) {
    next.notes = `${next.notes}\n\n${leftover.join("\n\n")}`.trim().slice(0, 8000);
  }

  return { record: normalizeFirstConversation(next), filledKeys: [...new Set(filledKeys)] };
}

export function firstConversationFieldPromptLines(
  kind: FirstConversationKind,
): string {
  return firstConversationSectionsForKind(kind)
    .flatMap((section) => section.fields)
    .map((item) => `- ${item.key}: ${item.label} — ${item.ask}`)
    .join("\n");
}
