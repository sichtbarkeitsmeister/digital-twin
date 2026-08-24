import type { SurveyPurpose } from "@/lib/surveys/purpose";
import type {
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";
import {
  applyClientAudienceToText,
  type ClientAudienceKind,
} from "@/lib/surveys/client-audience";

export type CoreQuestionPrefillHint =
  | "org_name"
  | "website"
  | "employee_count"
  | "owner_name"
  | "focus"
  | "region"
  | "usp"
  | "services"
  | "target_group"
  | "competitors"
  | "good_competitors"
  | "persona_name"
  | "persona_job"
  | "persona_age"
  | "persona_pain"
  | "colloquial_name"
  | "known_for"
  | "elevator_pitch"
  | "team_members"
  | "seo_metrics"
  | "online_channels"
  | "gbp_link"
  | "opening_hours"
  | "reviews"
  | "nap_address"
  | "company_history"
  | "portfolio_links"
  | "years_staff";

export type CoreQuestionTemplate = {
  key: string;
  stepId: string;
  stepTitle: string;
  stepDescription?: string;
  title: string;
  description: string;
  required: boolean;
  type: SurveyFieldType;
  options?: SurveyOption[];
  allowOtherOption?: boolean;
  allowExtraEntries?: boolean;
  allowCustomEntries?: boolean;
  addEntryLabel?: string;
  prefillHint?: CoreQuestionPrefillHint;
};

export function isIndustryPlaceholderLabel(label: string): boolean {
  return /vor Versand|\[Leistung\s|\[Option\s/.test(label);
}

function opt(id: string, label: string): SurveyOption {
  return { id, label };
}

function opts(prefix: string, labels: string[]): SurveyOption[] {
  return labels.map((label, index) => opt(`${prefix}_${index + 1}`, label));
}

/** Empty numbered slots for repeatable answers (default: 3, plus “add more”). */
function emptySlots(prefix: string, count = 3): SurveyOption[] {
  return Array.from({ length: count }, (_, index) => opt(`${prefix}_${index + 1}`, ""));
}

const YES_NO: SurveyOption[] = [opt("ja", "Ja"), opt("nein", "Nein")];

const PORTFOLIO_PLACEHOLDERS = [
  "[Leistung 1 – vor Versand passend zur Branche ersetzen]",
  "[Leistung 2 – vor Versand passend zur Branche ersetzen]",
  "[Leistung 3 – vor Versand passend zur Branche ersetzen]",
  "[Leistung 4 – vor Versand passend zur Branche ersetzen]",
];

const COMPANY_ARCHETYPES = [
  "Zeigt Kunden Möglichkeiten, an die sie vorher nicht gedacht hätten",
  "Versteht genau, was der Kunde wirklich will",
  "Verwandelt Wünsche in ein fertiges Ergebnis",
  "Bringt alle Beteiligten und Abläufe gut zusammen",
  "Achtet auf jedes kleine Detail",
  "Ist bekannt dafür, zuverlässig und pünktlich zu sein",
];

const RESPONSE_SPEED = [
  "innerhalb weniger Stunden",
  "innerhalb eines Tages",
  "innerhalb von 2 Tagen",
  "später",
];

const RESPONSE_CHANNELS = [
  "Telefon",
  "E-Mail",
  "WhatsApp",
  "über das Kontaktformular",
  "persönlich vor Ort",
];

const PRICE_POSITION = [
  "deutlich höher",
  "im Mittelfeld",
  "eher günstiger",
  "nicht vergleichbar, eigene Preisstruktur",
];

const PRICE_COMMUNICATION = [
  "offen auf der Website",
  "erst nach einem Gespräch",
  "teilweise sichtbar",
];

const VOLUME_VS_DEPTH = [
  "viele Kunden",
  "viel Zeit pro Auftrag",
  "beides gleich wichtig",
];

const CUSTOMER_VALUES = [
  "jeder Kunde bekommt eine individuelle Lösung",
  "Nachhaltigkeit statt schneller Lösungen",
  "Ehrlichkeit und offene Kommunikation",
  "Vertrauen und persönliche Beziehung",
  "hohe Qualität",
  "Zuverlässigkeit und Pünktlichkeit",
  "neue Ideen und moderne Methoden",
];

const SPEAKING_STYLES = [
  "persönlich und herzlich, wie mit einem guten Bekannten",
  "direkt und auf den Punkt",
  "motivierend und ermutigend",
  "ruhig und einfühlsam, besonders bei Unsicherheit",
  "sachlich und fachlich",
];

const ATTENTION_CHANNELS = [
  "Empfehlung von anderen",
  "Google-Suche",
  "Social Media",
  "direkt über die Website",
  "Zeitung oder Flyer",
  "Zusammenarbeit mit anderen Firmen",
  "persönlich vor Ort gesehen",
];

const ONLINE_CHANNELS = [
  "eigene Website",
  "Instagram",
  "Facebook",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Newsletter",
  "Google-Anzeigen",
];

type StepField = Omit<
  CoreQuestionTemplate,
  "stepId" | "stepTitle" | "stepDescription" | "description" | "required"
> & {
  description?: string;
  required?: boolean;
};

function step(
  stepId: string,
  stepTitle: string,
  fields: StepField[],
  stepDescription?: string,
): CoreQuestionTemplate[] {
  return fields.map((field, index) => ({
    description: "",
    required: true,
    ...field,
    stepId,
    stepTitle,
    stepDescription: index === 0 ? stepDescription : undefined,
  }));
}

const INDUSTRY_RANKING_PLACEHOLDERS = [
  "[Option 1 – vor Versand passend zur Branche eintragen]",
  "[Option 2 – vor Versand passend zur Branche eintragen]",
  "[Option 3 – vor Versand passend zur Branche eintragen]",
  "[Option 4 – vor Versand passend zur Branche eintragen]",
];

const PERSONA_AGE_CLASSES: SurveyOption[] = [
  opt("18_24", "18–24"),
  opt("25_34", "25–34"),
  opt("35_44", "35–44"),
  opt("45_54", "45–54"),
  opt("55_64", "55–64"),
  opt("65plus", "65 und älter"),
  opt("gemischt", "sehr gemischt"),
];

const PERSONA_JOB_RANKING = [
  "Angestellte",
  "Selbstständige oder Unternehmer",
  "Freiberufler",
  "Führungskräfte",
  "im Ruhestand",
];

const PERSONA_FAMILY = [
  "alleinstehend",
  "in einer Partnerschaft oder verheiratet",
  "mit Kindern im Haushalt",
  "Kinder sind schon ausgezogen",
];

const PERSONA_COMPARE_QUOTES: SurveyOption[] = [
  opt("fast_immer", "fast immer"),
  opt("manchmal", "manchmal"),
  opt("selten", "selten"),
  opt("fast_nie", "fast nie"),
];

const PERSONA_RESEARCH_ACTIVITY: SurveyOption[] = [
  opt("sehr_aktiv", "ja, sehr aktiv"),
  opt("etwas", "etwas"),
  opt("eher_nicht", "eher nicht"),
];

const PERSONA_FIRST_MEETING_DETAIL: SurveyOption[] = [
  opt("jedes_detail", "möchte jedes Detail genau wissen, z. B. Ablauf, Kosten, Zeitplan"),
  opt("ueberblick", "möchte vor allem einen groben Überblick, Details später"),
  opt("gehoert", "erzählt selbst viel von der eigenen Situation, möchte vor allem gehört werden"),
  opt("vertraut", "stellt wenige Fragen, vertraut der fachlichen Einschätzung"),
];

const PERSONA_PERSONAL_LEVEL: SurveyOption[] = [
  opt("sehr_wichtig", "sehr wichtig, persönliche Verbindung ist kaufentscheidend"),
  opt("wichtig", "wichtig, braucht Zeit für Vertrauensaufbau, bleibt aber sachlich"),
  opt("zweitrangig", "eher zweitrangig, Ergebnis und Fachkompetenz zählen mehr"),
  opt("unwichtig", "unwichtig, rein sachliche Beziehung reicht"),
];

const PERSONA_DECISION_STYLE: SurveyOption[] = [
  opt("empfehlung", "fragt aktiv nach einer Empfehlung und folgt ihr"),
  opt("optionen", "möchte mehrere Optionen erklärt bekommen, entscheidet dann selbst"),
  opt("eigene", "hat meist schon eine klare eigene Vorstellung"),
  opt("preis", "lässt sich stark vom Preis leiten"),
];

const PERSONA_COMMUNICATION: SurveyOption[] = [
  opt("haeufig", "häufig, möchte laufend über den Fortschritt informiert werden"),
  opt("termine", "regelmäßig bei vereinbarten Terminen, aber nicht zwischendurch"),
  opt("probleme", "selten, meldet sich nur bei Problemen"),
  opt("nie", "fast nie, vertraut vollständig"),
];

const PERSONA_PROBLEM_REACTION: SurveyOption[] = [
  opt("kooperativ", "kooperativ, vertraut der fachlichen Einschätzung"),
  opt("verstehen", "möchte genau verstehen, bevor er zustimmt"),
  opt("unsicher", "reagiert unsicher oder besorgt, braucht Beruhigung"),
  opt("kritisch", "reagiert kritisch, hinterfragt viel"),
];

const PERSONA_INFO_SOURCES = [
  "Empfehlung von Bekannten",
  "Google-Bewertungen",
  "die eigene Website",
  "Social Media",
  "Presse",
];

const PERSONA_TRUST_SIGNALS = [
  "langjährige Erfahrung",
  "Zertifikate",
  "Bewertungen",
  "Referenzen",
  "persönlicher Eindruck",
];

const PERSONA_HOLD_BACK = [
  "Angst vor den Kosten",
  "Zeitmangel",
  "Unsicherheit, ob das Angebot passt",
  "schlechte frühere Erfahrung",
];

const PERSONA_PRAISE = [
  "Qualität",
  "Kommunikation",
  "Preis-Leistungs-Verhältnis",
  "Pünktlichkeit",
  "persönliche Betreuung",
];

const PERSONA_DECISION_INFLUENCERS = [
  "der Kunde selbst",
  "Partner",
  "Familie",
  "Freunde",
  "ein Berater",
];

const PERSONA_CONTACT_IS_CLIENT: SurveyOption[] = [
  opt("dieselbe", "meistens dieselbe Person"),
  opt("andere", "oft eine andere Person"),
];

export const ANBIETER_INFO_TEXT =
  "Bitte nur schreiben, was im Alltag wirklich so ist — keine Wunschvorstellung und keine Werbesprache. Kurze, konkrete Angaben helfen uns mehr als lange Texte. Mit dem Ausfüllen bestätigt die antwortende Person, dass alle Angaben auf eigenen, echten Erfahrungen beruhen.";

export const PERSONA_INFO_TEXT =
  "Dieser Fragebogen beschreibt den idealen Kunden: die Art von Person oder Firma, mit der die Zusammenarbeit am besten funktioniert. Bitte an echte Gespräche denken, nicht an eine erfundene Idealfigur. Besonders wichtig sind die eigenen Worte des Kunden (erster Anruf, Einwand, Wunsch) und der konkrete Anlass, warum überhaupt gesucht wird.\n\nMit dem Ausfüllen bestätigt die antwortende Person, dass alle Angaben auf eigenen, echten Erfahrungen beruhen.";

export function surveyInfoTextForPurpose(
  purpose: SurveyPurpose,
  audience: ClientAudienceKind = "unternehmen",
): {
  infoTextEnabled: boolean;
  infoText: string;
} {
  if (purpose === "intern") {
    return { infoTextEnabled: false, infoText: "" };
  }
  if (purpose === "anbieter") {
    return {
      infoTextEnabled: true,
      infoText: applyClientAudienceToText(ANBIETER_INFO_TEXT, audience, {
        replaceBusiness: true,
      }),
    };
  }
  return {
    infoTextEnabled: true,
    infoText: applyClientAudienceToText(PERSONA_INFO_TEXT, audience),
  };
}

/** TEIL A – Fragebogen zum eigenen Unternehmen (Alltagssprache). */
export const ANBIETER_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  ...step(
    "core_intro",
    "Kontaktperson",
    [
      {
        key: "respondent_name",
        title: "Wer füllt diesen Fragebogen hauptsächlich aus – Name?",
        description: "Vor- und Nachname der Person, die antwortet.",
        type: "text",
        prefillHint: "owner_name",
      },
      {
        key: "respondent_role",
        title: "Welche Rolle oder Position hat diese Person in der Firma?",
        description: "z. B. Inhaber, Geschäftsführung, Assistenz, Marketing.",
        type: "text",
      },
    ],
    "Wer den Fragebogen ausfüllt.",
  ),
  ...step(
    "core_company",
    "Das Unternehmen",
    [
      {
        key: "company_name",
        title:
          "Wie lautet der vollständige Name der Firma, so wie er offiziell im Impressum oder Handelsregister steht (inklusive Rechtsform, z. B. GmbH, GbR, e.K.)?",
        description:
          "Genau wie im Impressum, z. B. „Müller & Partner Rechtsanwaltsgesellschaft mbH“. Nicht die Kurzform aus der Werbung.",
        type: "text",
        prefillHint: "org_name",
      },
      {
        key: "colloquial_name",
        title:
          "Wie wird die Firma im Alltag genannt – von Kunden, im Team oder von Partnern (z. B. eine Kurzform oder ein Spitzname)?",
        description: "z. B. „Müller Kanzlei“, „Praxis am Park“ oder nur der Nachname.",
        type: "text",
        prefillHint: "colloquial_name",
      },
      {
        key: "location_catchment",
        title:
          "Wo befindet sich der Firmensitz, und aus welcher Umgebung oder Region kommt der Großteil der Kunden?",
        description:
          "z. B. „Sitz in Dortmund, die meisten Kunden aus dem Ruhrgebiet; bundesweit nur in Spezialfällen.“",
        type: "text",
        prefillHint: "region",
      },
      {
        key: "portfolio",
        title: "Welche Leistungen oder Produkte werden aktuell angeboten?",
        description:
          "Bitte nur ankreuzen, was wirklich angeboten wird. Die Liste kommt soweit möglich von der Website — fehlende Punkte über „Sonstiges“ ergänzen.",
        type: "checkbox",
        options: opts("portfolio", PORTFOLIO_PLACEHOLDERS),
        allowOtherOption: true,
        prefillHint: "services",
      },
      {
        key: "usp",
        title:
          "Was macht das eigene Angebot besonders im Vergleich zu anderen Anbietern in der Region – was kann die eigene Firma, das andere nicht können oder nicht anbieten?",
        description:
          "Nicht der Werbeslogan, sondern der praktische Unterschied. z. B. „Wir vertreten nur Arbeitnehmer, nie Arbeitgeber“ oder „Festpreis vor dem ersten Spatenstich“.",
        type: "text",
        prefillHint: "usp",
      },
      {
        key: "company_archetype",
        title:
          "Welche der folgenden Beschreibungen passt am besten zum Unternehmen – bitte in eine Reihenfolge bringen.",
        description: "Oben steht, was Kunden als Erstes merken sollen — nicht alles kann Platz 1 sein.",
        type: "ranking",
        options: opts("archetype", COMPANY_ARCHETYPES),
        allowCustomEntries: false,
      },
    ],
    "Name, Standort, Angebot und was die Firma besonders macht.",
  ),
  ...step(
    "core_offer",
    "Leistungen & Ablauf",
    [
      {
        key: "services_ranked",
        title: "Welche Leistungen oder Angebote werden am häufigsten gebucht oder nachgefragt?",
        description:
          "Dieselbe Liste wie oben. Nach oben, was am häufigsten nachgefragt wird — nicht, was am liebsten angeboten wird.",
        type: "ranking",
        options: opts("svc_rank", PORTFOLIO_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "typical_process",
        title:
          "Wie läuft es typischerweise ab, von der ersten Anfrage bis zum fertigen Ergebnis oder Abschluss?",
        description:
          "Ein Schritt pro Feld. Beispiel: 1. Anruf oder Formular 2. Erstgespräch 3. Angebot 4. Zusage 5. Umsetzung 6. Abschlussgespräch.",
        type: "text_list",
        options: emptySlots("process", 3),
        allowExtraEntries: true,
        addEntryLabel: "Schritt hinzufügen",
      },
      {
        key: "response_speed",
        title: "Wie schnell wird auf eine neue Anfrage in der Regel reagiert?",
        description: "Die Regel im Alltag, nicht der Bestfall.",
        type: "radio",
        options: opts("resp_speed", RESPONSE_SPEED),
      },
      {
        key: "response_channels",
        title: "Auf welchem Weg wird meistens reagiert?",
        description: "Mehrfach möglich. z. B. erst per Telefon, Bestätigung danach per E-Mail.",
        type: "checkbox",
        options: opts("resp_ch", RESPONSE_CHANNELS),
        allowOtherOption: true,
      },
      {
        key: "price_position",
        title: "Sind die eigenen Preise im Vergleich zu anderen Anbietern eher höher, ähnlich oder niedriger?",
        description: "So, wie es Kunden im Gespräch oft einordnen — nicht die interne Kalkulation.",
        type: "radio",
        options: opts("price_pos", PRICE_POSITION),
      },
      {
        key: "price_communication",
        title:
          "Werden die Preise offen auf der Website gezeigt, oder werden sie erst nach einem persönlichen Gespräch genannt?",
        type: "radio",
        options: opts("price_com", PRICE_COMMUNICATION),
      },
      {
        key: "price_communication_reason",
        title: "Aus welchem Grund wird das so gehandhabt?",
        description: "z. B. „Jedes Mandat ist anders“ oder „Transparente Festpreise sollen Hürden senken“.",
        type: "text",
      },
      {
        key: "min_order_value",
        title:
          "Ab welchem ungefähren Auftragswert (in Euro) lohnt sich ein Projekt oder eine Buchung wirklich – und ab welcher Größe wird ein Auftrag eher abgelehnt, weil er zu klein ist?",
        description: "z. B. „Unter 1.500 € nehmen wir in der Regel nicht an, außer Bestandskunden.“",
        type: "text",
      },
      {
        key: "service_area",
        title:
          "Bis zu welcher Entfernung (z. B. in Kilometern) wird gearbeitet, und gibt es Ausnahmen für besondere Projekte?",
        description: "z. B. „50 km um Dortmund, bundesweit nur bei Großprojekten.“ Bei reiner Online-Arbeit bitte „bundesweit / online“ eintragen.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_values",
    "Werte & Arbeitsweise",
    [
      {
        key: "quality_assurance",
        title: "Woran wird gemerkt, dass ein Ziel erreicht wurde und die Qualität stimmt?",
        description:
          "z. B. Checkliste vor Abgabe, Vier-Augen-Prinzip, Nachbesprechung mit dem Kunden, messbares Ergebnis.",
        type: "text",
      },
      {
        key: "unexpected_challenges",
        title: "Wie wird reagiert, wenn während eines Projekts etwas Unerwartetes passiert oder sich etwas ändert?",
        description:
          "Der übliche Ablauf, z. B. „sofort anrufen, Optionen nennen, schriftlich festhalten“ — nicht der Ausnahmefall.",
        type: "text",
      },
      {
        key: "volume_vs_depth",
        title:
          "Ist es wichtiger, möglichst viele Kunden zu haben, oder sich bei jedem einzelnen Auftrag besonders viel Zeit zu nehmen?",
        type: "radio",
        options: opts("vol_depth", VOLUME_VS_DEPTH),
      },
      {
        key: "no_fit_clients",
        title:
          "Mit welchen Kundentypen oder Projekten wird lieber nicht zusammengearbeitet? Wann wird klar gesagt: „Das passt nicht zu uns“?",
        description:
          "z. B. „Keine Verkehrsunfälle“, „keine Dumping-Anfragen“, „keine reinen Online-Beratungen ohne Termin“.",
        type: "text",
      },
      {
        key: "customer_values",
        title:
          "Welche der folgenden Werte sind im Umgang mit Kunden am wichtigsten – bitte in eine Reihenfolge bringen.",
        description: "Was im Alltag wirklich zählt, wenn es eng wird — nicht die Website-Floskeln.",
        type: "ranking",
        options: opts("cust_val", CUSTOMER_VALUES),
        allowCustomEntries: false,
      },
    ],
  ),
  ...step(
    "core_language",
    "Sprache & Wortwahl",
    [
      {
        key: "speaking_style",
        title: "Wie wird normalerweise mit dem Kunden gesprochen – bitte in eine Reihenfolge bringen.",
        type: "ranking",
        options: opts("speak", SPEAKING_STYLES),
        allowCustomEntries: false,
      },
      {
        key: "address_form",
        title: "Wird auf der Website und in Texten „Du“ oder „Sie“ verwendet?",
        description: "Du/Sie als Inhalt der Texte, nicht als Anrede in diesem Fragebogen.",
        type: "radio",
        options: [opt("du", "Du"), opt("sie", "Sie")],
      },
      {
        key: "typical_terms",
        title:
          "Gibt es bestimmte Wörter oder Formulierungen, die immer wieder verwendet werden sollen, weil sie typisch für die Firma sind?",
        description: "Ein Wort oder eine Formulierung pro Feld.",
        type: "text_list",
        options: emptySlots("typical_term", 3),
        allowExtraEntries: true,
        addEntryLabel: "Begriff hinzufügen",
      },
      {
        key: "forbidden_terms",
        title: "Gibt es Wörter oder Formulierungen, die auf keinen Fall verwendet werden sollen?",
        description: "Ein Begriff pro Feld.",
        type: "text_list",
        options: emptySlots("forbidden_term", 3),
        allowExtraEntries: true,
        addEntryLabel: "Begriff hinzufügen",
      },
      {
        key: "philosophy_quotes",
        title:
          "Gibt es einen Satz oder eine Aussage der Geschäftsführung, der oder die die eigene Haltung besonders gut auf den Punkt bringt? Bitte wortwörtlich.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_team",
    "Team & Qualifikationen",
    [
      {
        key: "team_members",
        title: "Wer gehört zum Team, und wer macht was?",
        description: "Pro Person: Name und Rolle/Zuständigkeit, z. B. Anna Müller, Inhaberin.",
        type: "text_list",
        options: emptySlots("team", 3),
        allowExtraEntries: true,
        addEntryLabel: "Person hinzufügen",
        prefillHint: "team_members",
      },
      {
        key: "qualifications",
        title:
          "Welche Ausbildungen, Zertifikate, Auszeichnungen oder Mitgliedschaften gibt es im Team oder in der Firma – und gibt es dazu jeweils einen Link oder ein Dokument als Nachweis?",
        description: "Pro Eintrag: Bezeichnung und Link oder Dokumentname.",
        type: "text_list",
        options: emptySlots("quali", 3),
        allowExtraEntries: true,
        addEntryLabel: "Eintrag hinzufügen",
      },
      {
        key: "company_history",
        title: "Seit wann gibt es die Firma, und was waren die wichtigsten Meilensteine seitdem?",
        description:
          "Ein Eintrag pro Station: Jahr und Ereignis. Gemeint sind konkrete Wendepunkte, nicht der Alltag. Beispiele: „2012 – Praxis gegründet“, „2018 – Umzug in eigene Räume“, „2021 – zweite Fachkraft eingestellt“, „2024 – neues Behandlungsangebot“. Keine Slogans wie „stetiges Wachstum“.",
        type: "text_list",
        options: emptySlots("milestone", 3),
        allowExtraEntries: true,
        addEntryLabel: "Meilenstein hinzufügen",
        prefillHint: "company_history",
      },
      {
        key: "partners_suppliers",
        title: "Mit welchen Partnern oder Lieferanten wird zusammengearbeitet, und warum genau mit diesen?",
        description: "Pro Partner: Name und Grund.",
        type: "text_list",
        options: emptySlots("partner", 3),
        allowExtraEntries: true,
        addEntryLabel: "Partner hinzufügen",
      },
    ],
  ),
  ...step(
    "core_proof",
    "Erfolge & belegbare Zahlen",
    [
      {
        key: "testimonials",
        title: "Gibt es Aussagen von Kunden, die die eigene Arbeit besonders gut beschreiben? Bitte wortwörtlich.",
        description:
          "Pro Zitat: der Satz und optional Name oder Quelle. z. B. „Endlich hat uns jemand verständlich erklärt, worum es geht. — Familie K., Google“.",
        type: "text_list",
        options: emptySlots("quote", 3),
        allowExtraEntries: true,
        addEntryLabel: "Zitat hinzufügen",
      },
      {
        key: "why_stay",
        title: "Aus welchem Grund bleiben Kunden langfristig, statt nach einem Projekt oder Kauf wegzubleiben?",
        type: "text",
      },
      {
        key: "proven_metrics",
        title:
          "Welche konkreten Kennzahlen zum Unternehmenserfolg können genannt werden — inklusive der stärksten Ergebnisse mit Kunden?",
        description:
          "Nur Zahlen, die stimmen. Pro Zeile eine Kennzahl, z. B. „über 300 abgeschlossene Fälle“, „12 Mitarbeitende“, „Umsatz plus 30 % in 2024“, „4,9 Sterne bei 80 Google-Bewertungen“.",
        type: "text_list",
        options: emptySlots("metric", 3),
        allowExtraEntries: true,
        addEntryLabel: "Kennzahl hinzufügen",
        prefillHint: "seo_metrics",
      },
    ],
  ),
  ...step(
    "core_market",
    "Bekanntheit & Auffindbarkeit im Internet",
    [
      {
        key: "competitors_respected",
        title:
          "Welche anderen Anbieter werden respektiert – und was machen sie ehrlich gesagt besser?",
        type: "text",
        prefillHint: "good_competitors",
      },
      {
        key: "competitors_top",
        title: "Welche drei bis fünf Anbieter sind die wichtigsten Mitbewerber?",
        description:
          "Pro Mitbewerber: Name, Website und kurzer Grund (z. B. gleiche Region, ähnliches Angebot, ähnlicher Preis).",
        type: "text_list",
        options: emptySlots("comp_top", 3),
        allowExtraEntries: true,
        addEntryLabel: "Mitbewerber hinzufügen",
        prefillHint: "competitors",
      },
      {
        key: "attention_channels",
        title: "Wie wird ein neuer Kunde meistens zuerst auf die Firma aufmerksam? Bitte in eine Reihenfolge bringen.",
        type: "ranking",
        options: opts("attn", ATTENTION_CHANNELS),
        allowCustomEntries: false,
      },
      {
        key: "keyword_offer",
        title:
          "Unter welchen Wörtern soll die Firma bei Google gefunden werden – Angebotsbegriffe? Wonach würde jemand suchen, der genau nach diesem Angebot sucht?",
        description:
          "Ein Begriff pro Feld. Beispiele: „Arbeitsrecht Dortmund“, „Heilpraktiker Rückenschmerzen“, „Schlüsselfertig bauen Unna“. Intern heißen sie Fokus-Keywords.",
        type: "text_list",
        options: emptySlots("kw_offer", 3),
        allowExtraEntries: true,
        addEntryLabel: "Wort hinzufügen",
        prefillHint: "focus",
      },
      {
        key: "keyword_problem",
        title:
          "Wie würde jemand sein Problem in eigenen Worten in die Google-Suche eintippen? (Problembegriffe)",
        description:
          "Die Worte des Kunden, nicht die Fachbegriffe. z. B. „Chef zahlt Überstunden nicht“, „Zahnschmerzen über Nacht“, „Anbau genehmigen lassen“.",
        type: "text_list",
        options: emptySlots("kw_problem", 3),
        allowExtraEntries: true,
        addEntryLabel: "Wort hinzufügen",
      },
      {
        key: "keyword_place",
        title: "Mit welchem Ort zusammen soll die Firma gefunden werden (z. B. „Zahnarzt Düsseldorf“)?",
        description:
          "Ort oder Region, den Kunden wirklich eingeben. z. B. Stadtteil, Stadt, „Ruhrgebiet“, „NRW“.",
        type: "text_list",
        options: emptySlots("kw_place", 3),
        allowExtraEntries: true,
        addEntryLabel: "Wort hinzufügen",
      },
      {
        key: "online_channels",
        title:
          "Welche Online-Kanäle werden aktuell aktiv genutzt (z. B. eigene Website, Instagram, Facebook, LinkedIn, YouTube, TikTok, Newsletter, Google-Anzeigen)?",
        type: "checkbox",
        options: opts("online", ONLINE_CHANNELS),
        allowOtherOption: true,
        prefillHint: "online_channels",
      },
      {
        key: "seasonal_yesno",
        title: "Gibt es bestimmte Monate oder Zeiträume, in denen deutlich mehr oder weniger Anfragen kommen?",
        type: "radio",
        options: YES_NO,
      },
      {
        key: "seasonal_details",
        title: "Falls ja: welche Zeiträume, und was ist vermutlich der Grund?",
        type: "text",
      },
      {
        key: "ai_search_yesno",
        title:
          "Wurde selbst schon einmal in ChatGPT oder einem ähnlichen Programm (eine Art Suchmaschine zum Chatten) nach der eigenen Firma gefragt, um zu sehen, was dabei herauskommt?",
        description: "Falls nein: kein Problem, das wird im Rahmen der eigenen Recherche ohnehin geprüft.",
        type: "radio",
        options: YES_NO,
      },
      {
        key: "ai_search_result",
        title: "Falls ja: was kam dabei heraus?",
        type: "text",
      },
      {
        key: "desired_perception",
        title:
          "Wie soll die Firma heute und in Zukunft wahrgenommen werden – was sollen Menschen über sie denken oder sagen?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_future",
    "Zukunft & Pläne",
    [
      {
        key: "three_year_goal",
        title: "Wo soll die Firma in zwei bis drei Jahren stehen?",
        type: "text",
      },
      {
        key: "marketing_12_months",
        title: "Welche Marketing-Maßnahmen sind für die nächsten zwölf Monate geplant oder gewünscht?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_closing",
    "Abschluss",
    [
      {
        key: "anything_else",
        title: "Gibt es noch etwas Wichtiges über die Firma, das bisher nicht gefragt wurde?",
        type: "text",
      },
      {
        key: "elevator_pitch",
        title: "Wie beschreibt sich die Firma selbst in drei bis fünf Sätzen?",
        description:
          "So, als würde man es einem Bekannten in 30 Sekunden erzählen: wer, für wen, was anders ist. Keine Werbesprache.",
        type: "text",
        prefillHint: "elevator_pitch",
      },
    ],
    "Was sonst noch wichtig ist, in eigenen Worten.",
  ),
];

/** TEIL B – Fragebogen zum Wunschkunden (Alltagssprache). */
export const PERSONA_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  ...step(
    "core_persona_avatar",
    "Wer ist der Wunschkunde",
    [
      {
        key: "persona_name",
        title:
          "Wie könnte dieser ideale Kunde heißen, wenn es eine echte Person wäre (Vor- und Nachname)? Das dient nur der besseren Vorstellung, es handelt sich nicht um eine echte Person.",
        description: "Ein erfundener Name hilft später bei Texten, z. B. „Julia Schröder“.",
        type: "text",
        prefillHint: "persona_name",
      },
      {
        key: "persona_description",
        title:
          "Wie lässt sich dieser ideale Kunde in drei bis fünf Sätzen beschreiben (ungefähres Alter, Lebenssituation, warum die Zusammenarbeit mit ihm besonders gut funktioniert)?",
        description:
          "Bitte konkret, z. B. „Anfang 40, führt einen Handwerksbetrieb, hat keine Zeit für Papierkram und will eine klare Empfehlung statt fünf Optionen.“",
        type: "text",
        prefillHint: "target_group",
      },
    ],
    "Der ideale Kunde – die Art von Person oder Firma, mit der die Zusammenarbeit am besten funktioniert.",
  ),
  ...step(
    "core_persona_demo",
    "Alter, Beruf & Lebenssituation",
    [
      {
        key: "persona_age",
        title: "In welchem Altersbereich ist der Großteil dieser Kunden?",
        type: "radio",
        options: PERSONA_AGE_CLASSES,
        prefillHint: "persona_age",
      },
      {
        key: "persona_job",
        title:
          "Welcher Beruf oder welche Lebenssituation kommt bei diesem Kunden am häufigsten vor? Bitte in eine Reihenfolge bringen.",
        type: "ranking",
        options: opts("persona_job", PERSONA_JOB_RANKING),
        allowExtraEntries: true,
        prefillHint: "persona_job",
      },
      {
        key: "persona_family",
        title: "Wie sieht die familiäre Situation dieses Kunden meistens aus?",
        type: "checkbox",
        options: opts("persona_family", PERSONA_FAMILY),
        allowOtherOption: true,
      },
      {
        key: "persona_regions",
        title: "Aus welcher Gegend oder welchen Orten kommt dieser Kunde hauptsächlich?",
        type: "text",
      },
      {
        key: "persona_budget",
        title:
          "In welchem Preisbereich bewegen sich typische Aufträge oder Buchungen mit diesem Kunden? Bitte konkrete Beträge oder Spannen nennen und nach Häufigkeit sortieren.",
        description:
          "Die Beträge kommen soweit möglich aus Branche und Website. Bitte prüfen und nach Häufigkeit sortieren, z. B. „1.500–3.000 €“ vor „über 10.000 €“.",
        type: "ranking",
        options: opts("persona_budget", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
    ],
  ),
  ...step(
    "core_persona_problems",
    "Warum wird überhaupt gesucht",
    [
      {
        key: "persona_trigger",
        title: "Was ist der Auslöser, der diesen Kunden dazu bringt, überhaupt nach einer Lösung zu suchen?",
        description:
          "Der konkrete Anlass, nicht das allgemeine Thema. z. B. „Abmahnung letzte Woche“, „akute Rückenschmerzen seit drei Tagen“, „Anbau soll im Frühjahr stehen“ — nicht „hat ein Problem“.",
        type: "text",
      },
      {
        key: "persona_goals",
        title:
          "Was will dieser Kunde zu Beginn der Zusammenarbeit am meisten erreichen? Bitte nach Häufigkeit sortieren.",
        description:
          "Was im Erstgespräch als Ziel genannt wird. Die Liste sollte zur Branche passen, z. B. „Kündigung abwenden“, „schmerzfrei durch den Alltag“, „Festpreis und Termin halten“.",
        type: "ranking",
        options: opts("persona_goal", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "persona_pain",
        title:
          "Wie beschreibt dieser Kunde sein eigenes Problem im ersten Gespräch – am besten mit den genauen Worten, die tatsächlich verwendet wurden?",
        description:
          "Bitte wortwörtlich, z. B. „Ich weiß nicht, ob ich mir das leisten kann“ oder „Mir ist wichtig, dass das nicht ewig dauert“.",
        type: "text",
        prefillHint: "persona_pain",
      },
      {
        key: "persona_past_frustrations",
        title:
          "Gab es schlechte Erfahrungen mit früheren Lösungen, anderen Anbietern oder eigenen Versuchen? Was wurde darüber gesagt?",
        description:
          "z. B. „Der letzte Anwalt hat wochenlang nicht zurückgerufen“ oder „Zwei Heilpraktiker, und es wurde nicht besser“.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_language",
    "Wie dieser Kunde spricht",
    [
      {
        key: "persona_first_contact_phrases",
        title:
          "Welche Sätze oder Formulierungen verwendet dieser Kunde am häufigsten beim allerersten Kontakt (erster Anruf, erste Nachricht)? Bitte wortwörtlich.",
        description:
          "Ein Satz pro Feld. z. B. „Können Sie mal kurz sagen, was das kostet?“ oder „Ich hätte da mal eine Frage zu …“.",
        type: "text_list",
        options: emptySlots("persona_phrase", 5),
        allowExtraEntries: true,
        addEntryLabel: "Formulierung hinzufügen",
      },
      {
        key: "persona_first_meeting_questions",
        title: "Was sind die häufigsten Fragen im ersten Gespräch?",
        description: "Eine Frage pro Feld.",
        type: "text_list",
        options: emptySlots("persona_q", 3),
        allowExtraEntries: true,
        addEntryLabel: "Frage hinzufügen",
      },
      {
        key: "persona_jargon_known",
        title: "Welche Fachbegriffe kennt und benutzt dieser Kunde selbst?",
        description: "Ein Begriff pro Feld.",
        type: "text_list",
        options: emptySlots("jargon_known", 3),
        allowExtraEntries: true,
        addEntryLabel: "Begriff hinzufügen",
      },
      {
        key: "persona_jargon_unknown",
        title: "Welche Fachbegriffe kennt dieser Kunde nicht oder verwechselt er?",
        description: "Ein Begriff pro Feld.",
        type: "text_list",
        options: emptySlots("jargon_unknown", 3),
        allowExtraEntries: true,
        addEntryLabel: "Begriff hinzufügen",
      },
      {
        key: "persona_research_activity",
        title: "Sucht dieser Kunde aktiv im Internet nach Informationen, bevor er sich meldet?",
        description:
          "Falls ja: bitte in der nächsten Frage oder kurz hier mitdenken, wo gesucht wird (Google, Bewertungen, Social Media) und wonach.",
        type: "radio",
        options: PERSONA_RESEARCH_ACTIVITY,
      },
      {
        key: "persona_website_missing",
        title: "Was hat dieser Kunde auf der eigenen Website vermisst oder nicht gefunden?",
        description:
          "z. B. „keine Preise“, „keine Fachrichtung klar erkennbar“, „kein Foto vom Team“, „Terminbuchung fehlt“.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_buying",
    "Wie die Entscheidung getroffen wird",
    [
      {
        key: "persona_time_to_order",
        title: "Wie lange dauert es normalerweise von der ersten Anfrage bis zur endgültigen Zusage?",
        type: "text",
      },
      {
        key: "persona_contact_is_client",
        title:
          "Ist die Person, die den Erstkontakt aufnimmt, meistens auch der eigentliche Auftraggeber (also die Person, die am Ende entscheidet und bezahlt), oder ist das oft jemand anderes (z. B. ein Familienmitglied, eine Assistenz, ein Angestellter)?",
        type: "radio",
        options: PERSONA_CONTACT_IS_CLIENT,
      },
      {
        key: "persona_contact_other",
        title: "Falls oft eine andere Person: wer ist das typischerweise?",
        type: "text",
      },
      {
        key: "persona_decision_influencers",
        title: "Wer redet bei der Entscheidung mit – nur der Kunde selbst, oder auch andere?",
        type: "ranking",
        options: opts("persona_influencer", PERSONA_DECISION_INFLUENCERS),
        allowExtraEntries: true,
      },
      {
        key: "persona_compare_quotes",
        title:
          "Holt dieser Kunde meistens mehrere Angebote von verschiedenen Anbietern ein, bevor er sich entscheidet?",
        type: "radio",
        options: PERSONA_COMPARE_QUOTES,
      },
      {
        key: "persona_tipping_point",
        title: "Was gibt am Ende den Ausschlag für die Entscheidung – was wird dazu gesagt?",
        type: "text",
      },
      {
        key: "persona_objections",
        title:
          "Welche Bedenken oder Zweifel werden vor der Entscheidung am häufigsten geäußert? Bitte nach Häufigkeit sortieren und wenn möglich wortwörtlich ergänzen.",
        description:
          "Was wirklich gesagt wird, z. B. „Das ist mir zu teuer“, „Ich muss das erst mit meinem Partner klären“, „Geht das nicht schneller?“",
        type: "ranking",
        options: opts("persona_objection", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "persona_why_no",
        title:
          "Aus welchen Gründen haben sich manche Interessenten am Ende doch für einen anderen Anbieter entschieden?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_personality",
    "Verhalten & Persönlichkeit",
    [
      {
        key: "persona_first_meeting_detail",
        title: "Wie viele Details möchte dieser Kunde im ersten Gespräch wissen?",
        type: "radio",
        options: PERSONA_FIRST_MEETING_DETAIL,
      },
      {
        key: "persona_personal_level",
        title: "Wie wichtig ist diesem Kunden eine persönliche, vertraute Beziehung?",
        type: "radio",
        options: PERSONA_PERSONAL_LEVEL,
      },
      {
        key: "persona_decision_style",
        title:
          "Wenn dieser Kunde zwischen mehreren Möglichkeiten wählen muss – folgt er eher einer Empfehlung, oder entscheidet er lieber selbst?",
        type: "radio",
        options: PERSONA_DECISION_STYLE,
      },
      {
        key: "persona_communication",
        title: "Wie oft meldet sich dieser Kunde während einer laufenden Zusammenarbeit?",
        type: "radio",
        options: PERSONA_COMMUNICATION,
      },
      {
        key: "persona_problem_reaction",
        title: "Wie reagiert dieser Kunde, wenn während der Zusammenarbeit etwas Unerwartetes passiert — z. B. ein Termin sich verschiebt?",
        description: "Die typische Reaktion, nicht der Extremfall.",
        type: "radio",
        options: PERSONA_PROBLEM_REACTION,
      },
    ],
    "Stilfragen mit fester Optionsliste.",
  ),
  ...step(
    "core_persona_trust",
    "Was Vertrauen schafft",
    [
      {
        key: "persona_info_sources",
        title:
          "Welche Informationsquellen werden im Gespräch positiv erwähnt (z. B. Empfehlung von Bekannten, Google-Bewertungen, die eigene Website, Social Media, Presse)?",
        description:
          "Auch, ob Google-Bewertungen oder die Website vorkommen. Oben steht, was am häufigsten genannt wird.",
        type: "ranking",
        options: opts("persona_source", PERSONA_INFO_SOURCES),
        allowExtraEntries: true,
      },
      {
        key: "persona_trust_signals",
        title:
          "Welche Nachweise oder Signale überzeugen diesen Kunden am meisten (z. B. langjährige Erfahrung, Zertifikate, Bewertungen, Referenzen, persönlicher Eindruck)?",
        type: "ranking",
        options: opts("persona_trust", PERSONA_TRUST_SIGNALS),
        allowExtraEntries: true,
      },
    ],
  ),
  ...step(
    "core_persona_hurdles",
    "Sorgen & Zweifel",
    [
      {
        key: "persona_hold_back",
        title:
          "Was hält diesen Kunden davon ab, sich zu melden, obwohl eigentlich Interesse besteht?",
        description:
          "Die Hürde vor dem ersten Kontakt — inkl. Sätze wie „Das wird sicher teuer“ oder „Ich will niemanden belästigen“.",
        type: "checkbox",
        options: opts("persona_hold", PERSONA_HOLD_BACK),
        allowOtherOption: true,
      },
      {
        key: "persona_hold_back_note",
        title: "Ergänzung dazu in eigenen Worten",
        type: "text",
      },
      {
        key: "persona_hurdle_remover",
        title: "Was hilft erfahrungsgemäß, diese Zurückhaltung zu überwinden?",
        description: "z. B. „Festpreis im Erstgespräch nennen“, „Rückruf am selben Tag“, „kostenloses kurzes Vorgespräch“.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_journey",
    "Der Weg vom ersten Kontakt zum Stammkunden",
    [
      {
        key: "persona_journey_steps",
        title:
          "Wie sieht der typische Weg aus, von dem Moment, in dem dieser Kunde zum ersten Mal von dem Angebot erfährt, bis er zum festen Kunden wird? Bitte zu jedem Schritt direkt auch die ungefähre Dauer angeben.",
        description:
          "Pro Schritt: was passiert und wie lange es dauert. Beispiel: „Google-Suche — 1 Tag“, „Erstgespräch — 30 Minuten“, „Bedenkzeit mit Partner — 3–7 Tage“, „Zusage“.",
        type: "text_list",
        options: emptySlots("persona_step", 3),
        allowExtraEntries: true,
        addEntryLabel: "Schritt hinzufügen",
      },
      {
        key: "persona_journey_dropoff",
        title: "An welcher Stelle springen die meisten Interessenten ab, und warum?",
        type: "text",
      },
      {
        key: "persona_alternatives",
        title:
          "Welche anderen Lösungen oder Anbieter werden ernsthaft in Betracht gezogen, bevor sich dieser Kunde entscheidet?",
        description:
          "Womit wird konkret verglichen? z. B. eine andere Kanzlei in der Stadt, „selbst machen“, „abwarten“, eine Klinik, ein Billiganbieter.",
        type: "ranking",
        options: opts("persona_alt", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
    ],
  ),
  ...step(
    "core_persona_aftercare",
    "Nach dem Abschluss",
    [
      {
        key: "persona_praise",
        title:
          "Was wird nach einem erfolgreichen Ergebnis am häufigsten gelobt (z. B. die Qualität, die Kommunikation, das Preis-Leistungs-Verhältnis, die Pünktlichkeit, die persönliche Betreuung)?",
        type: "ranking",
        options: opts("persona_praise", PERSONA_PRAISE),
        allowExtraEntries: true,
      },
      {
        key: "persona_fan_moment",
        title: "Wann genau wird aus diesem Kunden ein echter Fan? Was war der entscheidende Moment?",
        type: "text",
      },
      {
        key: "persona_referral_quote",
        title: "Was wird wortwörtlich gesagt, wenn dieser Kunde das Angebot weiterempfiehlt?",
        description: "Ein Zitat pro Feld.",
        type: "text_list",
        options: emptySlots("persona_ref", 3),
        allowExtraEntries: true,
        addEntryLabel: "Zitat hinzufügen",
      },
      {
        key: "persona_dissatisfaction",
        title: "Falls es Unzufriedenheit gab: was war der Grund, und was wurde dazu gesagt?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_hormozi",
    "Der große Wunsch & die größte Hürde",
    [
      {
        key: "persona_hormozi_dream",
        title:
          "Wie würde dieser Kunde den perfekten Ausgang beschreiben, wenn alles optimal gelaufen ist? Bitte möglichst wortwörtlich.",
        description:
          "z. B. „Dann habe ich Ruhe im Kopf und weiß, dass das erledigt ist“ oder „Dann kann ich wieder schmerzfrei arbeiten“.",
        type: "text",
      },
      {
        key: "persona_hormozi_urgency",
        title: "Warum sollte sich dieser Kunde jetzt entscheiden und nicht erst später?",
        description:
          "Der echte Zeitdruck, z. B. Frist, Schmerzen, Saison, geplanter Umzug — nicht „je früher desto besser“.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_close",
    "Abschluss",
    [
      {
        key: "persona_anything_else",
        title: "Gibt es noch etwas Wichtiges über diesen Kunden, das bisher nicht gefragt wurde?",
        type: "text",
      },
    ],
  ),
];

const NAP_CONSISTENCY: SurveyOption[] = [
  opt("ueberall_gleich", "ja, überall gleich"),
  opt("abweichungen", "nein, es gibt Abweichungen"),
  opt("nicht_geprueft", "noch nicht geprüft"),
];

const GA4_GTM: SurveyOption[] = [
  opt("ja", "ja"),
  opt("nein", "nein"),
  opt("teilweise", "teilweise"),
];

/** TEIL C – interner Agentur-Block (aktuell nicht in neuen Fragebögen angeboten). */
export const INTERN_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  ...step(
    "core_intern_intro",
    "Interner Hinweis",
    [
      {
        key: "intern_notice",
        title:
          "Diesen Abschnitt bitte nicht vom Kunden ausfüllen lassen – wird von Sichtbarkeitsmeister recherchiert und ergänzt.",
        description:
          "Interner Recherche-Block. Nicht in den Kunden-Link legen. Bestätigung, dass hier Agentur-Angaben folgen.",
        required: true,
        type: "radio",
        options: YES_NO,
      },
    ],
    "Nur für Sichtbarkeitsmeister. Technischer Status, den der Kunde in der Regel nicht kennt.",
  ),
  ...step(
    "core_intern_nap",
    "Auffindbarkeit & Konsistenz",
    [
      {
        key: "nap_consistency",
        title:
          "Stehen Firmenname, Adresse und Telefonnummer überall im Internet exakt gleich (eigene Website, Google-Unternehmensprofil, Branchenverzeichnisse)?",
        type: "radio",
        options: NAP_CONSISTENCY,
      },
      {
        key: "nap_deviations",
        title: "Welche Abweichungen wurden gefunden?",
        type: "text",
        prefillHint: "nap_address",
      },
      {
        key: "external_mentions_list",
        title:
          "Gibt es bekannte externe Erwähnungen der Firma, z. B. in der Presse, auf Fachportalen oder in Branchenverzeichnissen?",
        description: "Pro Erwähnung: Quelle und Link.",
        type: "text_list",
        options: emptySlots("mention", 3),
        allowExtraEntries: true,
        addEntryLabel: "Erwähnung hinzufügen",
      },
    ],
  ),
  ...step(
    "core_intern_tracking",
    "Tracking & Conversion",
    [
      {
        key: "ga4_gtm",
        title: "Sind Google Analytics (GA4) und der Google Tag Manager eingerichtet?",
        type: "radio",
        options: GA4_GTM,
      },
      {
        key: "conversion_goals",
        title:
          "Welche Handlungen werden aktuell als Conversion-Ziel (Key Event) gemessen, z. B. Kontaktformular, Anruf-Klick, Terminbuchung?",
        description: "Ein Ziel pro Feld.",
        type: "text_list",
        options: emptySlots("conv", 3),
        allowExtraEntries: true,
        addEntryLabel: "Ziel hinzufügen",
      },
      {
        key: "call_tracking_yesno",
        title: "Gibt es Call-Tracking oder eine Anbindung an ein CRM-System?",
        type: "radio",
        options: YES_NO,
      },
      {
        key: "call_tracking_system",
        title: "Welches System?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_intern_reviews",
    "Bewertungen",
    [
      {
        key: "review_platforms",
        title:
          "Wie viele Bewertungen liegen aktuell vor, mit welchem Durchschnitt, auf welchen Plattformen?",
        description: "Pro Plattform: Plattform, Anzahl, Durchschnitt und Link.",
        type: "text_list",
        options: emptySlots("reviews", 3),
        allowExtraEntries: true,
        addEntryLabel: "Plattform hinzufügen",
        prefillHint: "reviews",
      },
    ],
  ),
  ...step(
    "core_intern_gbp",
    "Local-SEO-Basisdaten",
    [
      {
        key: "gbp_link",
        title: "Link zum Google-Unternehmensprofil",
        type: "text",
        prefillHint: "gbp_link",
      },
      {
        key: "gbp_categories",
        title: "Hinterlegte Kategorien im Google-Unternehmensprofil",
        type: "text",
      },
      {
        key: "gbp_service_area",
        title: "Servicegebiet/Einzugsgebiet wie im Google-Unternehmensprofil hinterlegt",
        type: "text",
        prefillHint: "region",
      },
      {
        key: "gbp_hours",
        title:
          "Öffnungszeiten wie im Google-Unternehmensprofil hinterlegt, und ob diese aktuell sind",
        type: "text",
        prefillHint: "opening_hours",
      },
    ],
  ),
];

export function coreQuestionsForPurpose(purpose: SurveyPurpose): CoreQuestionTemplate[] {
  if (purpose === "anbieter") return ANBIETER_CORE_QUESTIONS;
  if (purpose === "intern") return INTERN_CORE_QUESTIONS;
  return PERSONA_CORE_QUESTIONS;
}

export function fieldIdForCoreKey(key: string): string {
  return `core_${key}`;
}

export function fieldFromCoreTemplate(
  t: CoreQuestionTemplate,
  patch?: { id?: string; title?: string; description?: string },
): SurveyField {
  const id = patch?.id ?? fieldIdForCoreKey(t.key);
  const title = (patch?.title ?? t.title).trim() || t.title;
  const description = patch?.description ?? t.description;
  const required = t.required;
  const base = { id, title, description, required };

  const options = (t.options ?? []).map((o) => ({ id: o.id, label: o.label }));

  if (t.type === "text") return { ...base, type: "text" };

  if (t.type === "text_list") {
    return {
      ...base,
      type: "text_list",
      options: options.length ? options : emptySlots(t.key, 3),
      allowExtraEntries: t.allowExtraEntries !== false,
      addEntryLabel: t.addEntryLabel?.trim() || undefined,
    };
  }

  if (t.type === "radio") {
    return {
      ...base,
      type: "radio",
      options: options.length ? options : YES_NO.map((o) => ({ ...o })),
      allowOtherOption: t.allowOtherOption === true,
    };
  }

  if (t.type === "checkbox") {
    return {
      ...base,
      type: "checkbox",
      options: options.length ? options : [opt(`${t.key}_1`, "Option 1")],
      allowOtherOption: t.allowOtherOption !== false,
    };
  }

  if (t.type === "ranking") {
    const rankingOptions =
      options.length >= 2
        ? options
        : [opt(`${t.key}_1`, "Option 1"), opt(`${t.key}_2`, "Option 2")];
    return {
      ...base,
      type: "ranking",
      options: rankingOptions,
      allowCustomEntries: (t.allowCustomEntries ?? t.allowExtraEntries) !== false,
    };
  }

  return { ...base, type: "rating", scale: { min: 1, max: 5 } };
}

export function buildCoreFields(templates: CoreQuestionTemplate[]): {
  steps: SurveyStep[];
  fieldIdsByKey: Record<string, string>;
} {
  const fieldIdsByKey: Record<string, string> = {};
  const byStep = new Map<
    string,
    { title: string; description: string; fields: SurveyField[] }
  >();

  for (const t of templates) {
    const fieldId = fieldIdForCoreKey(t.key);
    fieldIdsByKey[t.key] = fieldId;
    const field = fieldFromCoreTemplate(t, { id: fieldId });
    const existing = byStep.get(t.stepId);
    if (existing) {
      existing.fields.push(field);
    } else {
      byStep.set(t.stepId, {
        title: t.stepTitle,
        description: t.stepDescription ?? "",
        fields: [field],
      });
    }
  }

  const steps: SurveyStep[] = [...byStep.entries()].map(([id, step]) => ({
    id,
    title: step.title,
    description: step.description,
    fields: step.fields,
  }));

  return { steps, fieldIdsByKey };
}
