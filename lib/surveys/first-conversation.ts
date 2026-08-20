/**
 * Erstgespräch / Kundendefinition — client-safe model.
 * Agency-led first conversation, persisted per organisation, then reused
 * when generating Fragebögen (Meeting-Briefing).
 *
 * Three conversation kinds (Arztpraxis, Kanzlei, Weitere Unternehmen)
 * share stored keys but have separate spoken scripts.
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
  | "customerContact"
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
  | "wishMatchesFinance"
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
  customerContact: "",
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
  wishMatchesFinance: "",
  pagesOrLinks: "",
  notes: "",
};

/** Hidden in the form: kind via tabs; USP lives in the Anbieter-Fragebogen. */
export const FIRST_CONVERSATION_HIDDEN_KEYS: ReadonlySet<FirstConversationFieldKey> =
  new Set([
    "conversationKind",
    "goodCompetitors",
    "usp",
    "websiteIssues",
    "pagesOrLinks",
    "onlineChannels",
    "mandateGoals",
    "colloquialName",
    "employeeCount",
  ]);

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
    label: "Weitere Unternehmen",
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
 * Three separate conversation scripts. Shared storage keys; distinct asks.
 * USP / "Was unterscheidet euch?" is not asked here — that is the Anbieter-Fragebogen.
 */
function frameSection(kind: FirstConversationKind): FirstConversationSection {
  const v = vocabFor(kind);
  const extra =
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
  return {
    id: "frame",
    title: "Rahmen",
    description: "Nur notieren — dann ins Gespräch.",
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
          ? "Wie lautet der Praxisname — so wie er nach außen stehen soll?"
          : kind === "kanzlei"
            ? "Wie lautet der Kanzleiname — so wie auf dem Briefbogen?"
            : "Wie lautet der Firmenname — so wie im Impressum?",
        { placeholder: v.legalNamePlaceholder, kind: "input" },
      ),
      field("website", "Website", "Unter welcher Adresse ist die Website erreichbar?", {
        placeholder: "https://…",
        kind: "input",
      }),
      ...extra,
    ],
  };
}

function praxisSections(): FirstConversationSection[] {
  return [
    frameSection("praxis"),
    {
      id: "status",
      title: "Aktueller Stand",
      description: "Wie die Praxis gerade läuft, bevor es um Wunschpatienten geht.",
      fields: [
        field(
          "currentStatus",
          "Wie läuft die Praxis aktuell?",
          "Wie läuft die Praxis aktuell? Mix, was gut läuft, wo es hakt.",
          {
            placeholder: "z. B. läuft gut, Mix Privat/Selbstzahler, Wunsch mehr Stamm-Patienten",
            rows: 4,
          },
        ),
        field(
          "region",
          "Standort",
          "Ein Standort oder mehrere — weitere geplant?",
          { placeholder: "Ort, Umkreis, ein Standort oder mehrere…", rows: 2 },
        ),
        field(
          "bookingPath",
          "Wie kommen Patienten zu einem Termin?",
          "Telefon, Doctolib, Website, Empfehlung? Was ist an der Rezeption noch offen?",
          {
            placeholder: "z. B. Doctolib und Telefon, Rezeption noch in Arbeit",
            rows: 3,
          },
        ),
        field(
          "customerContact",
          "Kontaktperson der Patienten",
          "Wer ist die Kontaktperson der Patienten? Deckt sich das mit dem, der am Ende die Behandlung bucht?",
          {
            placeholder: "z. B. Patient selbst / Partner bucht / Eltern bei Kindern",
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
          "Welche Leistungen stehen heute im Mittelpunkt — nicht die komplette Liste?",
          { placeholder: "Die Angebote, die wirklich nachgefragt werden", rows: 4 },
        ),
        field(
          "focus",
          "Worauf spezialisieren?",
          "Worauf soll der Schwerpunkt liegen, wo soll die Praxis wachsen?",
          {
            placeholder: "z. B. Laser und größere Eingriffe, nicht die kleine Einzelleistung",
            rows: 3,
          },
        ),
      ],
    },
    {
      id: "customers",
      title: "Wunschpatienten",
      description: "Für wen Website und Avatar später gebaut werden. Fokus heißt nicht Ablehnung.",
      fields: [
        field(
          "targetGroup",
          "Welche Patienten sind am liebsten?",
          "Welche Patienten laufen gut — regelmäßig, passend, wenig Reibung?",
          {
            placeholder:
              "z. B. Privatpatienten, die regelmäßig zur Vorsorge kommen und etwas dazubuchen",
            rows: 4,
          },
        ),
        field(
          "unattractiveCustomers",
          "Welche Patienten sind eher unattraktiv?",
          "Wer kostet viel und bringt wenig — und soll deshalb nicht die Werbung bestimmen?",
          {
            placeholder: "z. B. Selbstzahler mit einmaliger kleiner Leistung, ohne Wiederkehr",
            rows: 3,
          },
        ),
        field(
          "keepOthers",
          "Andere bleiben willkommen?",
          "Heißt der Fokus auf Wunschpatienten, dass andere Patienten abgelehnt werden — oder bleibt die Entscheidung im Einzelfall?",
          {
            placeholder: "Meist: Fokus nur für Website und Werbung — Einzelfall bleibt bei der Praxis",
            rows: 2,
          },
        ),
        field(
          "wunschkundeLabel",
          "Ein bis zwei Wunschpatient-Typen",
          "Wie heißen die ein oder zwei Wunschpatient-Typen intern — Kurzname reicht, Details kommen im Fragebogen.",
          {
            placeholder: "z. B. Privatpatient mit Vorsorge-Anker / Laser-Interessent",
            kind: "input",
          },
        ),
      ],
    },
    {
      id: "visibility",
      title: "Wettbewerb",
      description: "Wen die Praxis als Markt kennt.",
      fields: [
        field(
          "competitors",
          "Wettbewerb",
          "Welche Anbieter kennt die Praxis als Wettbewerb oder als Orientierung?",
          {
            placeholder: "Name, kurzer Grund — Wettbewerb und Vorbilder in einem",
            rows: 4,
          },
        ),
      ],
    },
    {
      id: "future",
      title: "Zukunft",
      description: "Was geplant ist, und ob die Wunschpatienten zu den Zahlen passen.",
      fields: [
        field(
          "futurePlans",
          "Was ist geplant?",
          "Was ist für die nächsten Monate geplant?",
          { placeholder: "Neue Leistungen, Standort, Team, Inhalte…", rows: 3 },
        ),
        field(
          "wishMatchesFinance",
          "Wunschpatienten und Finanzen",
          "Deckt sich die Wunschkunden-Gruppe mit den finanziellen Zielen der Praxis?",
          {
            placeholder: "Ja / nein, und woran das hängt — Umsatzmix, Frequenz, Honorar",
            rows: 3,
          },
        ),
        field(
          "notes",
          "Weitere Notizen",
          "Gibt es noch etwas Wichtiges, das in keine Schublade passt?",
          { placeholder: "Ton im Gespräch, offene Punkte", rows: 3 },
        ),
      ],
    },
  ];
}

function kanzleiSections(): FirstConversationSection[] {
  return [
    frameSection("kanzlei"),
    {
      id: "status",
      title: "Aktueller Stand",
      description: "Wie die Kanzlei gerade läuft, bevor es um Wunschmandanten geht.",
      fields: [
        field(
          "currentStatus",
          "Wie läuft die Kanzlei aktuell?",
          "Wie läuft die Kanzlei aktuell? Mandate, was gut läuft, wo es hakt.",
          {
            placeholder: "z. B. Mandate voll, Engpass bei Sichtbarkeit, Wunsch klarere Positionierung",
            rows: 4,
          },
        ),
        field(
          "region",
          "Standort",
          "Ein Sitz oder mehrere — weitere geplant?",
          { placeholder: "Ort, Umkreis, ein Standort oder mehrere…", rows: 2 },
        ),
        field(
          "bookingPath",
          "Wie kommen Mandate zustande?",
          "Empfehlung, Website, Anruf, Portal?",
          { placeholder: "Nur der Weg, der wirklich genutzt wird", rows: 3 },
        ),
        field(
          "customerContact",
          "Kontaktperson der Mandanten",
          "Wer ist die Kontaktperson der Mandanten? Deckt sich das mit dem, der am Ende das Mandat beauftragt oder unterschreibt?",
          {
            placeholder: "z. B. Geschäftsführer selbst / Assistentin / Ehepartner",
            rows: 3,
          },
        ),
      ],
    },
    {
      id: "offer",
      title: "Leistungen und Fokus",
      description: "Rechtsgebiete heute, und worauf die Kanzlei sichtbar spezialisieren will.",
      fields: [
        field(
          "services",
          "Rechtsgebiete heute",
          "Welche Rechtsgebiete stehen heute im Mittelpunkt?",
          { placeholder: "Die Mandate, die wirklich angenommen werden", rows: 4 },
        ),
        field(
          "focus",
          "Worauf spezialisieren?",
          "Worauf soll die Kanzlei sich sichtbar spezialisieren — welche Mandate sollen wachsen?",
          {
            placeholder: "z. B. Arbeitsrecht und Gesellschaftsrecht, nicht jedes Mandat gleich",
            rows: 3,
          },
        ),
      ],
    },
    {
      id: "customers",
      title: "Wunschmandanten",
      description: "Für wen Website und Avatar später gebaut werden. Fokus heißt nicht Ablehnung.",
      fields: [
        field(
          "targetGroup",
          "Welche Mandanten sind am liebsten?",
          "Welche Mandanten laufen gut — passend, wiederkehrend, wenig Reibung?",
          {
            placeholder: "z. B. Unternehmer mit laufendem Beratungsbedarf, nicht das einmalige Kleinstmandat",
            rows: 4,
          },
        ),
        field(
          "unattractiveCustomers",
          "Welche Mandate sind eher unattraktiv?",
          "Welche Mandate kosten viel und bringen wenig — und sollen deshalb nicht die Werbung bestimmen?",
          {
            placeholder: "Kurz, ohne Wertung im Gespräch — nur für die Ausrichtung",
            rows: 3,
          },
        ),
        field(
          "keepOthers",
          "Andere bleiben willkommen?",
          "Heißt der Fokus auf Wunschmandanten, dass andere Mandanten abgelehnt werden — oder bleibt die Entscheidung im Einzelfall?",
          {
            placeholder: "Meist: Fokus nur für Website und Werbung — Einzelfall bleibt bei der Kanzlei",
            rows: 2,
          },
        ),
        field(
          "wunschkundeLabel",
          "Ein bis zwei Wunschmandant-Typen",
          "Wie heißen die ein oder zwei Wunschmandant-Typen intern — Kurzname reicht, Details kommen im Fragebogen.",
          {
            placeholder: "z. B. Mittelstands-Geschäftsführer / Erbrecht-Familie",
            kind: "input",
          },
        ),
      ],
    },
    {
      id: "visibility",
      title: "Wettbewerb",
      description: "Wen die Kanzlei als Markt kennt.",
      fields: [
        field(
          "competitors",
          "Wettbewerb",
          "Welche Kanzleien kennt die Kanzlei als Wettbewerb oder als Orientierung?",
          {
            placeholder: "Name, kurzer Grund — Wettbewerb und Vorbilder in einem",
            rows: 4,
          },
        ),
      ],
    },
    {
      id: "future",
      title: "Zukunft",
      description: "Was geplant ist, und ob die Wunschmandanten zu den Zahlen passen.",
      fields: [
        field(
          "futurePlans",
          "Was ist geplant?",
          "Was ist für die nächsten Monate geplant?",
          { placeholder: "Neue Rechtsgebiete, Standort, Team, Inhalte…", rows: 3 },
        ),
        field(
          "wishMatchesFinance",
          "Wunschmandanten und Finanzen",
          "Deckt sich die Wunschkunden-Gruppe mit den finanziellen Zielen der Kanzlei?",
          {
            placeholder: "Ja / nein, und woran das hängt — Honorare, Mandatsmix, Frequenz",
            rows: 3,
          },
        ),
        field(
          "notes",
          "Weitere Notizen",
          "Gibt es noch etwas Wichtiges, das in keine Schublade passt?",
          { placeholder: "Ton im Gespräch, offene Punkte", rows: 3 },
        ),
      ],
    },
  ];
}

function weitereSections(): FirstConversationSection[] {
  return [
    frameSection("weitere"),
    {
      id: "status",
      title: "Aktueller Stand",
      description: "Wie das Geschäft gerade läuft, bevor es um Wunschkunden geht.",
      fields: [
        field(
          "currentStatus",
          "Wie läuft das Geschäft aktuell?",
          "Wie läuft das Geschäft aktuell? Auftragslage, was gut läuft, wo es hakt.",
          { placeholder: "Auftragslage, was gut läuft, wo es hakt", rows: 4 },
        ),
        field(
          "region",
          "Standort und Einzugsgebiet",
          "Wo sitzt die Firma, aus welcher Region kommen die Kunden — weitere Standorte geplant?",
          { placeholder: "Ort, Umkreis, ein Standort oder mehrere…", rows: 2 },
        ),
        field(
          "bookingPath",
          "Wie kommen Anfragen zustande?",
          "Anruf, Website, Empfehlung, Anzeige?",
          { placeholder: "Nur der Weg, der wirklich genutzt wird", rows: 3 },
        ),
        field(
          "customerContact",
          "Kontaktperson der Kunden",
          "Wer ist die Kontaktperson der Kunden? Deckt sich das mit dem, der am Ende kauft oder entscheidet?",
          {
            placeholder: "z. B. Inhaber selbst / Einkauf / Assistenz bucht nur den Termin",
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
          "Welche Leistungen oder Produkte stehen heute im Mittelpunkt?",
          { placeholder: "Die Angebote, die wirklich nachgefragt werden", rows: 4 },
        ),
        field(
          "focus",
          "Worauf spezialisieren?",
          "Worauf soll die Sichtbarkeit liegen — welches Angebot soll wachsen?",
          { placeholder: "Schwerpunkt, Fokus-Themen…", rows: 3 },
        ),
      ],
    },
    {
      id: "customers",
      title: "Wunschkunden",
      description: "Für wen Website und Avatar später gebaut werden. Fokus heißt nicht Ablehnung.",
      fields: [
        field(
          "targetGroup",
          "Welche Kunden sind am liebsten?",
          "Welche Kunden laufen gut — passend, wiederkehrend, wenig Reibung?",
          { placeholder: "Branche, Situation, typisches Anliegen…", rows: 4 },
        ),
        field(
          "unattractiveCustomers",
          "Welche Anfragen sind eher unattraktiv?",
          "Welche Anfragen kosten viel und bringen wenig — und sollen deshalb nicht die Werbung bestimmen?",
          { placeholder: "Kurz, ohne Wertung im Gespräch — nur für die Ausrichtung", rows: 3 },
        ),
        field(
          "keepOthers",
          "Andere bleiben willkommen?",
          "Heißt der Fokus auf Wunschkunden, dass andere Kunden abgelehnt werden — oder bleibt die Entscheidung im Einzelfall?",
          {
            placeholder: "Meist: Fokus nur für Website und Werbung — Einzelfall bleibt bei der Firma",
            rows: 2,
          },
        ),
        field(
          "wunschkundeLabel",
          "Ein bis zwei Wunschkunden-Typen",
          "Wie heißen die ein oder zwei Wunschkunden-Typen intern — Kurzname reicht, Details kommen im Fragebogen.",
          { placeholder: "z. B. Julia Schröder, Praxisinhaberin", kind: "input" },
        ),
      ],
    },
    {
      id: "visibility",
      title: "Wettbewerb",
      description: "Wen die Firma als Markt kennt.",
      fields: [
        field(
          "competitors",
          "Wettbewerb",
          "Welche Anbieter kennt die Firma als Wettbewerb oder als Orientierung?",
          {
            placeholder: "Name, kurzer Grund — Wettbewerb und Vorbilder in einem",
            rows: 4,
          },
        ),
      ],
    },
    {
      id: "future",
      title: "Zukunft",
      description: "Was geplant ist, und ob die Wunschkunden zu den Zahlen passen.",
      fields: [
        field(
          "futurePlans",
          "Was ist geplant?",
          "Was ist für die nächsten Monate geplant?",
          { placeholder: "Neue Leistungen, Standort, Team, Inhalte…", rows: 3 },
        ),
        field(
          "wishMatchesFinance",
          "Wunschkunden und Finanzen",
          "Deckt sich die Wunschkunden-Gruppe mit den finanziellen Zielen der Firma?",
          {
            placeholder: "Ja / nein, und woran das hängt — Marge, Auftragswert, Wiederkehr",
            rows: 3,
          },
        ),
        field(
          "notes",
          "Weitere Notizen",
          "Gibt es noch etwas Wichtiges, das in keine Schublade passt?",
          { placeholder: "Ton im Gespräch, offene Punkte", rows: 3 },
        ),
      ],
    },
  ];
}

export function firstConversationSectionsForKind(
  kind: FirstConversationKind,
): FirstConversationSection[] {
  if (kind === "kanzlei") return kanzleiSections();
  if (kind === "weitere") return weitereSections();
  return praxisSections();
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
  push("Kontaktperson Kunden", record.customerContact);
  push("Online-Kanäle", record.onlineChannels);
  push("Website und Auftritt", record.websiteIssues);
  push("Weniger passende Kunden", record.unattractiveCustomers);
  push("Andere Kunden bleiben", record.keepOthers);
  push("Wunschkunde", record.wunschkundeLabel);
  push("Ziel des Mandats", record.mandateGoals);
  push("Zukunft und nächste Schritte", record.futurePlans);
  push("Wunschkunden und Finanzen", record.wishMatchesFinance);
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
  push("Kontaktperson", record.customerContact);
  push("Finanzen", record.wishMatchesFinance);
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
  [/^(?:kontaktperson|wer\s+bucht|entscheider)$/i, "customerContact"],
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
  [/^(?:wunschkunden\s+und\s+finanzen|finanzielle\s+ziele)$/i, "wishMatchesFinance"],
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
