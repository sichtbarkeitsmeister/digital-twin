/**
 * Vorschläge für Fragebogen-Wortwahl aus einer Branche (Entrümpler, Umzug, …).
 * Heuristik zuerst — KI kann denselben JSON-Shape nachschärfen.
 */

import {
  isClientAudienceKind,
  isNounGender,
  mergeAudienceVocab,
  type AudienceVocabFields,
  type ClientAudienceKind,
  type ClientAudienceVocab,
} from "@/lib/surveys/client-audience";

export type AudienceVocabSuggestion = {
  vocab: ClientAudienceVocab;
  source: "heuristic" | "ai";
  industry: string;
  note: string;
};

type IndustryRule = {
  test: RegExp;
  kind: ClientAudienceKind;
  fields?: Partial<AudienceVocabFields>;
  label?: string;
  hint?: string;
  note: string;
};

const RULES: IndustryRule[] = [
  {
    test: /steuerberat|rechtsanw|\banwalt\b|kanzlei|notar|wirtschaftspruef|wirtschaftsprüf/,
    kind: "kanzlei",
    note: "Rechts-/Steuerbranche → Mandant und Mandat.",
  },
  {
    test: /zahnarzt|zahnmed|zahnheil|kfo\b|kieferortho/,
    kind: "praxis",
    fields: { business: "Zahnarztpraxis", businessPlural: "Zahnarztpraxen", businessGender: "f" },
    label: "Zahnarztpraxis",
    note: "Zahnmedizin → Praxis, Patient, Behandlung.",
  },
  {
    test: /tierarzt|tierärzt|tierklinik/,
    kind: "praxis",
    fields: {
      business: "Tierarztpraxis",
      businessPlural: "Tierarztpraxen",
      businessGender: "f",
      singular: "Tierhalter",
      plural: "Tierhalter",
    },
    label: "Tierarztpraxis",
    note: "Tiermedizin → Praxis, Patient bleibt der behandelte Fall, Person oft Tierhalter.",
  },
  {
    test: /heilprakt|physio|osteopath|therapie|psycholog|psychother|arztpraxis|\barzt\b|ärztin|praxis/,
    kind: "praxis",
    note: "Gesundheitsbranche → Patient und Behandlung.",
  },
  {
    test: /entrümp|entruemp|haushalts?auflös|wohnungsräum|wohnungsraeum/,
    kind: "handwerk",
    fields: {
      business: "Betrieb",
      businessPlural: "Betriebe",
      businessGender: "m",
      engagement: "Entrümpelung",
      engagementPlural: "Entrümpelungen",
      engagementGender: "f",
      project: "Räumung",
      projectPlural: "Räumungen",
      projectGender: "f",
      booking: "Auftrag",
      bookingPlural: "Aufträge",
      bookingGender: "m",
    },
    label: "Entrümpelung",
    hint: "Entrümpelungsbetrieb — Person: Kunde. Arbeit: Entrümpelung.",
    note: "Entrümpelung → Betrieb, Kunde, Entrümpelung.",
  },
  {
    test: /umzug|spedition|möbeltransport|moebeltransport/,
    kind: "handwerk",
    fields: {
      business: "Umzugsunternehmen",
      businessPlural: "Umzugsunternehmen",
      businessGender: "n",
      engagement: "Umzug",
      engagementPlural: "Umzüge",
      engagementGender: "m",
      project: "Umzug",
      projectPlural: "Umzüge",
      projectGender: "m",
      booking: "Auftrag",
      bookingPlural: "Aufträge",
      bookingGender: "m",
    },
    label: "Umzugsunternehmen",
    hint: "Umzugsunternehmen — Person: Kunde. Arbeit: Umzug.",
    note: "Umzug → Umzugsunternehmen, Kunde, Umzug.",
  },
  {
    test: /reinigung|gebäuderein|gebaeuderein|hausmeister/,
    kind: "handwerk",
    fields: {
      engagement: "Einsatz",
      engagementPlural: "Einsätze",
      engagementGender: "m",
    },
    label: "Reinigung",
    note: "Reinigung → Betrieb, Kunde, Einsatz.",
  },
  {
    test: /dachdeck|elektriker|sanitaer|sanitär|heizung|maler|tischler|schreiner|fliesen|garten|installateur|schlosser|zimmerer|handwerk|meisterbetrieb/,
    kind: "handwerk",
    note: "Handwerk → Betrieb, Kunde, Auftrag.",
  },
  {
    test: /hotel|gastronomie|restaurant|gaststätte|gaststaette|pension|catering/,
    kind: "unternehmen",
    fields: {
      business: "Betrieb",
      businessPlural: "Betriebe",
      businessGender: "m",
      singular: "Gast",
      plural: "Gäste",
      engagement: "Buchung",
      engagementPlural: "Buchungen",
      engagementGender: "f",
      project: "Event",
      projectPlural: "Events",
      projectGender: "n",
      booking: "Buchung",
      bookingPlural: "Buchungen",
      bookingGender: "f",
    },
    label: "Gastronomie",
    hint: "Hotel/Gastronomie — Person: Gast. Arbeit: Buchung.",
    note: "Gastro → Betrieb, Gast, Buchung.",
  },
  {
    test: /agentur|marketing|werbe|designbüro|designbuero/,
    kind: "unternehmen",
    fields: {
      business: "Agentur",
      businessPlural: "Agenturen",
      businessGender: "f",
      engagement: "Projekt",
      engagementPlural: "Projekte",
      engagementGender: "n",
      project: "Projekt",
      projectPlural: "Projekte",
      projectGender: "n",
    },
    label: "Agentur",
    note: "Agentur → Agentur, Kunde, Projekt.",
  },
  {
    test: /coach|beratung|consult/,
    kind: "unternehmen",
    fields: {
      business: "Beratung",
      businessPlural: "Beratungen",
      businessGender: "f",
      engagement: "Beratung",
      engagementPlural: "Beratungen",
      engagementGender: "f",
      project: "Mandat",
      projectPlural: "Mandate",
      projectGender: "n",
    },
    label: "Beratung",
    note: "Beratung → Beratung, Kunde, Beratung.",
  },
];

function haystack(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

function applyRule(rule: IndustryRule, industry: string): AudienceVocabSuggestion {
  const vocab = mergeAudienceVocab(rule.kind, rule.fields);
  return {
    vocab: {
      ...vocab,
      label: rule.label ?? vocab.label,
      hint: rule.hint ?? vocab.hint,
    },
    source: "heuristic",
    industry: industry.trim(),
    note: rule.note,
  };
}

export function heuristicSuggestAudienceVocab(input: {
  industry?: string | null;
  organisationName?: string | null;
  services?: string[] | null;
}): AudienceVocabSuggestion | null {
  const industry = (input.industry ?? "").trim();
  const blob = haystack([industry, input.organisationName, ...(input.services ?? [])]);
  if (!blob) return null;

  for (const rule of RULES) {
    if (rule.test.test(blob)) return applyRule(rule, industry || input.organisationName || "");
  }
  return null;
}

function optionalWord(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return undefined;
  return trimmed;
}

function optionalNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 240);
}

/** Parse a model/heuristic JSON object into a full vocab. Missing fields keep the kind defaults. */
export function parseAudienceVocabSuggestion(
  raw: unknown,
  fallbackKind: ClientAudienceKind = "unternehmen",
): ClientAudienceVocab | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const kind = isClientAudienceKind(rec.kind) ? rec.kind : fallbackKind;
  const fields: Partial<AudienceVocabFields> = {};
  const assignWord = (key: keyof AudienceVocabFields, value: unknown) => {
    const word = optionalWord(value);
    if (word) (fields[key] as string) = word;
  };
  assignWord("business", rec.business);
  assignWord("businessPlural", rec.businessPlural);
  assignWord("singular", rec.singular);
  assignWord("plural", rec.plural);
  assignWord("engagement", rec.engagement);
  assignWord("engagementPlural", rec.engagementPlural);
  assignWord("project", rec.project);
  assignWord("projectPlural", rec.projectPlural);
  assignWord("booking", rec.booking);
  assignWord("bookingPlural", rec.bookingPlural);
  if (isNounGender(rec.businessGender)) fields.businessGender = rec.businessGender;
  if (isNounGender(rec.engagementGender)) fields.engagementGender = rec.engagementGender;
  if (isNounGender(rec.projectGender)) fields.projectGender = rec.projectGender;
  if (isNounGender(rec.bookingGender)) fields.bookingGender = rec.bookingGender;

  const base = mergeAudienceVocab(kind, fields);
  const label = optionalWord(rec.label) ?? base.label;
  const hint = optionalNote(rec.hint) || base.hint;
  if (!base.business || !base.singular || !base.engagement) return null;
  return { ...base, label, hint };
}

export function parseAudienceVocabSuggestionPayload(
  raw: unknown,
  fallbackKind: ClientAudienceKind = "unternehmen",
): { vocab: ClientAudienceVocab; note: string } | null {
  const vocab = parseAudienceVocabSuggestion(raw, fallbackKind);
  if (!vocab) return null;
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { vocab, note: optionalNote(rec.note) };
}

/** Heuristic match, or a safe Firma/Kunde/Auftrag default when the industry is unknown. */
export function fallbackSuggestAudienceVocab(input: {
  industry?: string | null;
  organisationName?: string | null;
  services?: string[] | null;
}): AudienceVocabSuggestion {
  const matched = heuristicSuggestAudienceVocab(input);
  if (matched) return matched;
  const industry = (input.industry ?? "").trim() || (input.organisationName ?? "").trim();
  return {
    vocab: mergeAudienceVocab("unternehmen"),
    source: "heuristic",
    industry,
    note: "Keine klare Branche erkannt — Standard Firma, Kunde, Auftrag. Bitte Felder prüfen oder KI vorschlagen lassen.",
  };
}
