/**
 * Wer wird im Fragebogen angesprochen: Mandant, Patient oder Kunde.
 * Vorlagen bleiben bei „Kunde“/„Firma“; diese Schicht ersetzt die Wörter
 * passend zur gewählten Unternehmensart.
 *
 * Kanzlei: die Person heißt Mandant (wie Kunde/Patient).
 * Das Mandat ist der Auftrag / das Mandatsverhältnis — nicht die Person.
 */

export const CLIENT_AUDIENCE_KINDS = ["kanzlei", "praxis", "unternehmen"] as const;

export type ClientAudienceKind = (typeof CLIENT_AUDIENCE_KINDS)[number];

export type ClientAudienceVocab = {
  kind: ClientAudienceKind;
  /** Button-Label im Wizard */
  label: string;
  /** Kurzer Hinweis unter dem Button */
  hint: string;
  /** Person: Mandant | Patient | Kunde */
  singular: string;
  /** Personen: Mandanten | Patienten | Kunden */
  plural: string;
  /** Betrieb: Kanzlei | Praxis | Firma */
  business: string;
  businessPlural: string;
};

export const CLIENT_AUDIENCE_OPTIONS: ClientAudienceVocab[] = [
  {
    kind: "kanzlei",
    label: "Kanzlei",
    hint: "Rechtsanwälte, Steuerberater, Notare — Person: Mandant. Auftrag: Mandat.",
    singular: "Mandant",
    plural: "Mandanten",
    business: "Kanzlei",
    businessPlural: "Kanzleien",
  },
  {
    kind: "praxis",
    label: "Praxis / Heilpraktiker",
    hint: "Arztpraxis, Heilpraktiker, Therapie — im Fragebogen steht Patient.",
    singular: "Patient",
    plural: "Patienten",
    business: "Praxis",
    businessPlural: "Praxen",
  },
  {
    kind: "unternehmen",
    label: "Anderes Unternehmen",
    hint: "Handwerk, Bau, Agentur, Handel — im Fragebogen steht Kunde.",
    singular: "Kunde",
    plural: "Kunden",
    business: "Firma",
    businessPlural: "Firmen",
  },
];

export function isClientAudienceKind(value: unknown): value is ClientAudienceKind {
  return value === "kanzlei" || value === "praxis" || value === "unternehmen";
}

export function clientAudienceVocab(kind: ClientAudienceKind): ClientAudienceVocab {
  return CLIENT_AUDIENCE_OPTIONS.find((item) => item.kind === kind) ?? CLIENT_AUDIENCE_OPTIONS[2]!;
}

export function clientAudienceLabel(kind: ClientAudienceKind): string {
  return clientAudienceVocab(kind).label;
}

/**
 * Ersetzt Kunden-/Firmen-Wörter in Fragebogen-Texten.
 * Reihenfolge ist wichtig (längere Formen zuerst).
 *
 * `replaceBusiness` nur für Anbieter-Fragen: Firma → Kanzlei/Praxis.
 * In Persona-Fragen nicht, weil „Person oder Firma“ den Wunschkunden meint.
 */
export function applyClientAudienceToText(
  text: string,
  kind: ClientAudienceKind,
  options: { replaceBusiness?: boolean } = {},
): string {
  if (!text) return text;
  if (kind === "unternehmen") return text;

  const v = clientAudienceVocab(kind);
  let out = text;

  out = out.replace(/Wunschkunden/g, `Wunsch${v.plural.toLowerCase()}`);
  out = out.replace(/Wunschkunde/g, `Wunsch${v.singular.toLowerCase()}`);
  out = out.replace(/Kundentypen/g, `${v.plural}typen`);
  out = out.replace(/Kunden-Persona/g, `${v.plural}-Persona`);
  out = out.replace(/\bKunden\b/g, v.plural);
  out = out.replace(/\bKunde\b/g, v.singular);
  out = out.replace(/kundentypen/g, `${v.plural.toLowerCase()}typen`);
  out = out.replace(/\bkunden\b/g, v.plural.toLowerCase());
  out = out.replace(/\bkunde\b/g, v.singular.toLowerCase());

  if (kind === "kanzlei") {
    out = out.replace(/\bAufträge\b/g, "Mandate");
    out = out.replace(/\bAuftrag\b/g, "Mandat");
  } else if (kind === "praxis") {
    out = out.replace(/\bAufträge\b/g, "Behandlungen");
    out = out.replace(/\bAuftrag\b/g, "Behandlung");
  }

  if (options.replaceBusiness) {
    out = applyBusinessAudienceToText(out, kind);
  }

  return out;
}

export function applyBusinessAudienceToText(text: string, kind: ClientAudienceKind): string {
  if (!text || kind === "unternehmen") return text;
  const v = clientAudienceVocab(kind);
  let out = text;
  out = out.replace(/Firmensitz/g, `${v.business}sitz`);
  out = out.replace(/\bFirmen\b/g, v.businessPlural);
  out = out.replace(/\bFirma\b/g, v.business);
  if (out === "Das Unternehmen") {
    return kind === "kanzlei" ? "Die Kanzlei" : "Die Praxis";
  }
  return out;
}
