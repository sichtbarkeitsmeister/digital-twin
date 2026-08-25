/**
 * Wortwahl im Fragebogen: wie über Anbieter, Kunden und die Arbeit gesprochen wird.
 * Vorlagen bleiben bei „Kunde“ / „Firma“ / „Auftrag“; diese Schicht ersetzt die Wörter
 * passend zur gewählten Unternehmensart — inklusive Beispiele und Artikel (ein/eine).
 */

export const CLIENT_AUDIENCE_KINDS = ["kanzlei", "praxis", "handwerk", "unternehmen"] as const;

export type ClientAudienceKind = (typeof CLIENT_AUDIENCE_KINDS)[number];

export type NounGender = "m" | "f" | "n";

export type AudienceVocabFields = {
  /** Betrieb: Kanzlei | Praxis | Betrieb | Firma */
  business: string;
  businessPlural: string;
  businessGender: NounGender;
  /** Person: Mandant | Patient | Kunde */
  singular: string;
  plural: string;
  /** Arbeit: Mandat | Behandlung | Auftrag */
  engagement: string;
  engagementPlural: string;
  engagementGender: NounGender;
  /** Vorhaben: Mandat | Behandlung | Projekt */
  project: string;
  projectPlural: string;
  projectGender: NounGender;
  /** Buchung | Termin | Auftrag */
  booking: string;
  bookingPlural: string;
  bookingGender: NounGender;
};

export type ClientAudienceVocab = AudienceVocabFields & {
  kind: ClientAudienceKind;
  /** Button-Label im Wizard */
  label: string;
  /** Kurzer Hinweis unter dem Button */
  hint: string;
};

type NounSpec = {
  singular: string;
  plural: string;
  gender: NounGender;
  genitive?: string;
};

const KUNDE: NounSpec = { singular: "Kunde", plural: "Kunden", gender: "m" };
const MANDANT: NounSpec = { singular: "Mandant", plural: "Mandanten", gender: "m" };
const PATIENT: NounSpec = { singular: "Patient", plural: "Patienten", gender: "m" };
const FIRMA: NounSpec = { singular: "Firma", plural: "Firmen", gender: "f" };
const KANZLEI: NounSpec = { singular: "Kanzlei", plural: "Kanzleien", gender: "f" };
const PRAXIS: NounSpec = { singular: "Praxis", plural: "Praxen", gender: "f" };
const BETRIEB: NounSpec = { singular: "Betrieb", plural: "Betriebe", gender: "m" };
const AUFTRAG: NounSpec = {
  singular: "Auftrag",
  plural: "Aufträge",
  gender: "m",
  genitive: "Auftrags",
};
const MANDAT: NounSpec = {
  singular: "Mandat",
  plural: "Mandate",
  gender: "n",
  genitive: "Mandats",
};
const BEHANDLUNG: NounSpec = {
  singular: "Behandlung",
  plural: "Behandlungen",
  gender: "f",
  genitive: "Behandlung",
};
const PROJEKT: NounSpec = {
  singular: "Projekt",
  plural: "Projekte",
  gender: "n",
  genitive: "Projekts",
};
const BUCHUNG: NounSpec = {
  singular: "Buchung",
  plural: "Buchungen",
  gender: "f",
  genitive: "Buchung",
};

/** der / die / das + ein / eine / einem … */
const ARTICLES: Record<
  NounGender,
  {
    ein: string;
    einen: string;
    einem: string;
    eines: string;
    der: string;
    den: string;
    dem: string;
    des: string;
    jeder: string;
    jeden: string;
    jedem: string;
    jedes: string;
  }
> = {
  m: {
    ein: "ein",
    einen: "einen",
    einem: "einem",
    eines: "eines",
    der: "der",
    den: "den",
    dem: "dem",
    des: "des",
    jeder: "jeder",
    jeden: "jeden",
    jedem: "jedem",
    jedes: "jedes",
  },
  f: {
    ein: "eine",
    einen: "eine",
    einem: "einer",
    eines: "einer",
    der: "die",
    den: "die",
    dem: "der",
    des: "der",
    jeder: "jede",
    jeden: "jede",
    jedem: "jeder",
    jedes: "jeder",
  },
  n: {
    ein: "ein",
    einen: "ein",
    einem: "einem",
    eines: "eines",
    der: "das",
    den: "das",
    dem: "dem",
    des: "des",
    jeder: "jedes",
    jeden: "jedes",
    jedem: "jedem",
    jedes: "jedes",
  },
};

const ARTICLE_KEYS = [
  "der",
  "jeder",
  "ein",
  "den",
  "dem",
  "des",
  "einen",
  "einem",
  "eines",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function replaceWhole(text: string, from: string, to: string) {
  if (!from || from === to) return text;
  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
  return text.replace(re, to);
}

function replaceNoun(text: string, from: NounSpec, to: NounSpec): string {
  if (
    from.singular === to.singular &&
    from.plural === to.plural &&
    from.gender === to.gender
  ) {
    return text;
  }

  const fromArt = ARTICLES[from.gender];
  const toArt = ARTICLES[to.gender];
  const pairs: Array<[string, string]> = [];

  for (const key of ARTICLE_KEYS) {
    pairs.push([`${fromArt[key]} ${from.singular}`, `${toArt[key]} ${to.singular}`]);
    pairs.push([
      `${capitalize(fromArt[key])} ${from.singular}`,
      `${capitalize(toArt[key])} ${to.singular}`,
    ]);
  }

  const fromGen = from.genitive ?? `${from.singular}s`;
  const toGen = to.genitive ?? `${to.singular}s`;
  if (fromGen !== from.singular) pairs.push([fromGen, toGen]);
  pairs.push([from.plural, to.plural]);
  pairs.push([from.singular, to.singular]);

  pairs.sort((a, b) => b[0].length - a[0].length);

  let out = text;
  for (const [source, target] of pairs) {
    out = replaceWhole(out, source, target);
  }
  return out;
}

function valueWord(engagement: string) {
  const trimmed = engagement.trim();
  if (!trimmed) return "Auftragswert";
  if (/[sßx]$/i.test(trimmed)) return `${trimmed}wert`;
  return `${trimmed}swert`;
}

function nounFromVocab(
  singular: string,
  plural: string,
  gender: NounGender,
): NounSpec {
  return { singular, plural, gender };
}

export const CLIENT_AUDIENCE_OPTIONS: ClientAudienceVocab[] = [
  {
    kind: "kanzlei",
    label: "Kanzlei",
    hint: "Rechtsanwälte, Steuerberater, Notare — Person: Mandant. Arbeit: Mandat.",
    singular: "Mandant",
    plural: "Mandanten",
    business: "Kanzlei",
    businessPlural: "Kanzleien",
    businessGender: "f",
    engagement: "Mandat",
    engagementPlural: "Mandate",
    engagementGender: "n",
    project: "Mandat",
    projectPlural: "Mandate",
    projectGender: "n",
    booking: "Mandat",
    bookingPlural: "Mandate",
    bookingGender: "n",
  },
  {
    kind: "praxis",
    label: "Praxis / Heilpraktiker",
    hint: "Arztpraxis, Heilpraktiker, Therapie — Person: Patient. Arbeit: Behandlung.",
    singular: "Patient",
    plural: "Patienten",
    business: "Praxis",
    businessPlural: "Praxen",
    businessGender: "f",
    engagement: "Behandlung",
    engagementPlural: "Behandlungen",
    engagementGender: "f",
    project: "Behandlung",
    projectPlural: "Behandlungen",
    projectGender: "f",
    booking: "Termin",
    bookingPlural: "Termine",
    bookingGender: "m",
  },
  {
    kind: "handwerk",
    label: "Handwerk / Betrieb",
    hint: "Handwerker, Bau, Meisterbetrieb — Person: Kunde. Arbeit: Auftrag.",
    singular: "Kunde",
    plural: "Kunden",
    business: "Betrieb",
    businessPlural: "Betriebe",
    businessGender: "m",
    engagement: "Auftrag",
    engagementPlural: "Aufträge",
    engagementGender: "m",
    project: "Projekt",
    projectPlural: "Projekte",
    projectGender: "n",
    booking: "Auftrag",
    bookingPlural: "Aufträge",
    bookingGender: "m",
  },
  {
    kind: "unternehmen",
    label: "Anderes Unternehmen",
    hint: "Agentur, Handel, Dienstleister — Person: Kunde. Arbeit: Auftrag / Projekt.",
    singular: "Kunde",
    plural: "Kunden",
    business: "Firma",
    businessPlural: "Firmen",
    businessGender: "f",
    engagement: "Auftrag",
    engagementPlural: "Aufträge",
    engagementGender: "m",
    project: "Projekt",
    projectPlural: "Projekte",
    projectGender: "n",
    booking: "Buchung",
    bookingPlural: "Buchungen",
    bookingGender: "f",
  },
];

export function isClientAudienceKind(value: unknown): value is ClientAudienceKind {
  return (
    value === "kanzlei" ||
    value === "praxis" ||
    value === "handwerk" ||
    value === "unternehmen"
  );
}

export function isNounGender(value: unknown): value is NounGender {
  return value === "m" || value === "f" || value === "n";
}

export function clientAudienceVocab(kind: ClientAudienceKind): ClientAudienceVocab {
  return CLIENT_AUDIENCE_OPTIONS.find((item) => item.kind === kind) ?? CLIENT_AUDIENCE_OPTIONS[3]!;
}

export function clientAudienceLabel(kind: ClientAudienceKind): string {
  return clientAudienceVocab(kind).label;
}

export function mergeAudienceVocab(
  kind: ClientAudienceKind,
  overrides?: Partial<AudienceVocabFields> | null,
): ClientAudienceVocab {
  const base = clientAudienceVocab(kind);
  if (!overrides) return { ...base };
  const pick = (key: keyof AudienceVocabFields, fallback: AudienceVocabFields[typeof key]) => {
    const value = overrides[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : fallback;
    }
    if (key.endsWith("Gender") && isNounGender(value)) return value;
    return fallback;
  };
  return {
    ...base,
    business: pick("business", base.business) as string,
    businessPlural: pick("businessPlural", base.businessPlural) as string,
    businessGender: pick("businessGender", base.businessGender) as NounGender,
    singular: pick("singular", base.singular) as string,
    plural: pick("plural", base.plural) as string,
    engagement: pick("engagement", base.engagement) as string,
    engagementPlural: pick("engagementPlural", base.engagementPlural) as string,
    engagementGender: pick("engagementGender", base.engagementGender) as NounGender,
    project: pick("project", base.project) as string,
    projectPlural: pick("projectPlural", base.projectPlural) as string,
    projectGender: pick("projectGender", base.projectGender) as NounGender,
    booking: pick("booking", base.booking) as string,
    bookingPlural: pick("bookingPlural", base.bookingPlural) as string,
    bookingGender: pick("bookingGender", base.bookingGender) as NounGender,
  };
}

export type AudienceRef = ClientAudienceKind | ClientAudienceVocab;

export function resolveAudienceVocab(audience: AudienceRef | null | undefined): ClientAudienceVocab {
  if (!audience) return clientAudienceVocab("unternehmen");
  if (typeof audience === "string") return clientAudienceVocab(audience);
  return mergeAudienceVocab(audience.kind, audience);
}

function applyBusinessAudienceToVocab(text: string, vocab: ClientAudienceVocab): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/Firmensitz|Kanzleisitz|Praxissitz|Betriebssitz/g, `${vocab.business}sitz`);
  out = replaceNoun(out, KANZLEI, FIRMA);
  out = replaceNoun(out, PRAXIS, FIRMA);
  out = replaceNoun(out, BETRIEB, FIRMA);
  out = replaceNoun(
    out,
    FIRMA,
    nounFromVocab(vocab.business, vocab.businessPlural, vocab.businessGender),
  );
  if (vocab.business !== "Firma") {
    const businessArticle = capitalize(ARTICLES[vocab.businessGender].der);
    out = out.replace(/\bDas Unternehmen\b/g, `${businessArticle} ${vocab.business}`);
  }
  return out;
}

/**
 * Ersetzt Kunden-/Firmen-/Auftrags-Wörter in Fragebogen-Texten.
 * Reihenfolge ist wichtig (längere Formen zuerst).
 *
 * `replaceBusiness` nur für Anbieter-Fragen: Firma → Kanzlei/Praxis/Betrieb.
 * In Persona-Fragen nicht, weil „Person oder Firma“ den Wunschkunden meint.
 */
export function applyClientAudienceToText(
  text: string,
  audience: AudienceRef,
  options: { replaceBusiness?: boolean } = {},
): string {
  if (!text) return text;
  const vocab = resolveAudienceVocab(audience);
  let out = text;

  out = out.replace(/Wunschkunden/g, `Wunsch${vocab.plural.toLowerCase()}`);
  out = out.replace(/Wunschkunde/g, `Wunsch${vocab.singular.toLowerCase()}`);
  out = out.replace(/Kundentypen/g, `${vocab.plural}typen`);
  out = out.replace(/Kunden-Persona/g, `${vocab.plural}-Persona`);
  out = out.replace(/kundentypen/g, `${vocab.plural.toLowerCase()}typen`);

  out = out.replace(
    /Auftragswert|Mandatswert|Behandlungswert/g,
    valueWord(vocab.engagement),
  );

  // Zuerst branchenfremde Wörter auf die Vorlagen-Sprache (Kunde/Auftrag) bringen,
  // danach die Ziel-Wortwahl anwenden — so werden auch feste Beispiele wie „Mandat“ korrekt.
  out = replaceNoun(out, PATIENT, KUNDE);
  out = replaceNoun(out, MANDANT, KUNDE);
  out = replaceNoun(out, BEHANDLUNG, AUFTRAG);
  out = replaceNoun(out, MANDAT, AUFTRAG);

  out = replaceNoun(out, KUNDE, nounFromVocab(vocab.singular, vocab.plural, "m"));
  out = replaceNoun(
    out,
    AUFTRAG,
    nounFromVocab(vocab.engagement, vocab.engagementPlural, vocab.engagementGender),
  );
  out = replaceNoun(
    out,
    PROJEKT,
    nounFromVocab(vocab.project, vocab.projectPlural, vocab.projectGender),
  );
  out = replaceNoun(
    out,
    BUCHUNG,
    nounFromVocab(vocab.booking, vocab.bookingPlural, vocab.bookingGender),
  );

  if (options.replaceBusiness) {
    out = applyBusinessAudienceToVocab(out, vocab);
  }

  return out;
}

export function applyBusinessAudienceToText(text: string, kind: ClientAudienceKind): string {
  return applyBusinessAudienceToVocab(text, clientAudienceVocab(kind));
}

export function audienceWordingPreview(vocab: ClientAudienceVocab): string {
  return applyClientAudienceToText(
    "Über die Firma wird mit dem Kunden über den Auftrag gesprochen. z. B. „Jeder Auftrag ist anders.“",
    vocab,
    { replaceBusiness: true },
  );
}

export const GENDER_SELECT_OPTIONS: Array<{ value: NounGender; label: string }> = [
  { value: "m", label: "der / ein" },
  { value: "f", label: "die / eine" },
  { value: "n", label: "das / ein" },
];
