import type { SurveyPurpose } from "@/lib/surveys/purpose";
import type {
  SurveyField,
  SurveyFieldType,
  SurveyOption,
  SurveyStep,
} from "@/lib/surveys/types";

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

const COMPANY_VOICE = [
  "Wir von [Firmenname]…",
  "Firmenname direkt, z. B. „[Firmenname] hilft dabei…“",
  "Ich-Form, falls Einzelperson",
];

const JARGON_LEVEL = [
  "möglichst keine",
  "dürfen vorkommen, werden aber immer erklärt",
  "auch mit vielen Fachbegriffen",
];

const TEXT_LENGTH = [
  "kurz und knapp",
  "ausführlich mit Details",
  "je nach Textart unterschiedlich",
];

const PUBLIC_USE = [
  "mit Namen",
  "nur ohne Namen",
  "kommt auf das Beispiel an",
];

const IMAGE_ASSETS = [
  "Vorher-Nachher-Fotos",
  "Fotos vom Team",
  "Fotos vom Arbeitsprozess",
  "Videos",
  "keines vorhanden",
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

const RESPONDENT_IS_CLIENT: SurveyOption[] = [
  opt("ja_dieselbe", "ja, dieselbe Person"),
  opt("nein_andere", "nein, es ist jemand anderes"),
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
    required: false,
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
  "im Ruhestand",
];

const PERSONA_CUSTOMER_GROUP_PLACEHOLDERS = [
  "[Kundentyp 1 – vor Versand ersetzen]",
  "[Kundentyp 2 – vor Versand ersetzen]",
  "[Kundentyp 3 – vor Versand ersetzen]",
  "[Kundentyp 4 – vor Versand ersetzen]",
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

const PERSONA_DELAY_REACTION: SurveyOption[] = [
  opt("locker", "locker und gelassen, solange gut informiert wird"),
  opt("enttäuscht", "enttäuscht, aber kooperativ bei guter Kommunikation"),
  opt("ungeduldig", "ungeduldig, fragt schnell nach"),
  opt("veraergert", "verärgert, reagiert empfindlich"),
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
  "Partner oder Partnerin",
  "Familie",
  "Freunde",
  "eine Fachperson oder Berater",
];

/** TEIL A – Fragebogen zum eigenen Unternehmen (Alltagssprache). */
export const ANBIETER_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  ...step(
    "core_intro",
    "Einleitung & Kontaktperson",
    [
      {
        key: "confirm_real_experience",
        title:
          "Bestätigung, dass alle folgenden Angaben auf eigenen, echten Erfahrungen beruhen und nicht geraten sind.",
        description: "Bitte mit Ja oder Nein antworten. Ohne diese Bestätigung ist der Fragebogen nicht auswertbar.",
        required: true,
        type: "radio",
        options: YES_NO,
      },
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
      {
        key: "respondent_is_client",
        title:
          "Ist diese Person auch die eigentliche Auftraggeberin bzw. der eigentliche Auftraggeber (z. B. Inhaber oder Geschäftsführung), oder füllt hier jemand anderes aus?",
        type: "radio",
        options: RESPONDENT_IS_CLIENT,
      },
      {
        key: "actual_client_visibility",
        title:
          "Falls es sich um zwei verschiedene Personen handelt: Wer ist der eigentliche Auftraggeber, und soll diese Person auf der Website im Vordergrund stehen (z. B. als Gesicht der Firma), oder eher das Team allgemein?",
        type: "text",
      },
    ],
    "Nur Angaben auf Basis eigener, echter Erfahrungen.",
  ),
  ...step(
    "core_company",
    "Das Unternehmen",
    [
      {
        key: "company_name",
        title:
          "Wie lautet der vollständige Name der Firma, so wie er offiziell im Impressum oder Handelsregister steht (inklusive Rechtsform, z. B. GmbH, GbR, e.K.)?",
        required: true,
        type: "text",
        prefillHint: "org_name",
      },
      {
        key: "colloquial_name",
        title:
          "Wie wird die Firma im Alltag genannt – von Kunden, im Team oder von Partnern (z. B. eine Kurzform oder ein Spitzname)?",
        type: "text",
        prefillHint: "colloquial_name",
      },
      {
        key: "location_catchment",
        title:
          "Wo befindet sich der Firmensitz, und aus welcher Umgebung oder Region kommt der Großteil der Kunden?",
        description:
          "Bitte Ort plus Region oder Kreis/Bezirk nennen, nicht nur die Stadt. Weitere Standorte und geplante Standorte können hier mit angegeben werden.",
        type: "text",
        prefillHint: "region",
      },
      {
        key: "portfolio",
        title: "Welche Leistungen oder Produkte werden aktuell angeboten?",
        description:
          "Liste vor Versand passend zur Branche ersetzen. „Sonstiges“ bleibt frei. Wenn es Leistungsseiten, Flyer oder PDFs gibt, Links im nächsten Feld eintragen.",
        type: "checkbox",
        options: opts("portfolio", PORTFOLIO_PLACEHOLDERS),
        allowOtherOption: true,
        prefillHint: "services",
      },
      {
        key: "portfolio_links",
        title: "Links zu Leistungsseiten, Flyern oder anderen Unterlagen",
        description: "Website-URLs, PDF-Links oder Dateinamen. Leer lassen, wenn nichts vorliegt.",
        type: "text",
        prefillHint: "portfolio_links",
      },
      {
        key: "known_for",
        title: "Wofür ist die Firma in der Region bekannt – was sagen Menschen darüber, wenn sie sie erwähnen?",
        type: "text",
        prefillHint: "known_for",
      },
      {
        key: "usp",
        title: "Was macht das eigene Angebot besonders im Vergleich zu anderen Anbietern in der Region?",
        type: "text",
        prefillHint: "usp",
      },
      {
        key: "competitor_gap",
        title: "Was kann die eigene Firma, das andere Anbieter in der Region nicht können oder nicht anbieten?",
        type: "text",
      },
      {
        key: "company_archetype",
        title: "Welche der folgenden Beschreibungen passt am besten – bitte in eine Reihenfolge bringen.",
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
          "Vor Versand dieselbe Liste wie bei den Leistungen eintragen. Reihenfolge nach Häufigkeit.",
        type: "ranking",
        options: opts("svc_rank", PORTFOLIO_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "typical_process",
        title:
          "Wie läuft es typischerweise ab, von der ersten Anfrage bis zum fertigen Ergebnis oder Abschluss?",
        description: "Ein Schritt pro Feld. Weitere Schritte können ergänzt werden.",
        type: "text_list",
        options: emptySlots("process", 3),
        allowExtraEntries: true,
        addEntryLabel: "Schritt hinzufügen",
      },
      {
        key: "response_speed",
        title: "Wie schnell wird auf eine neue Anfrage in der Regel reagiert?",
        type: "radio",
        options: opts("resp_speed", RESPONSE_SPEED),
      },
      {
        key: "response_channels",
        title: "Auf welchem Weg wird meistens reagiert?",
        description:
          "Nicht der Weg, über den der Kunde anfragt, sondern der Weg, auf dem die Firma antwortet. Beispiel: Anfrage über das Kontaktformular, Antwort per Telefon oder WhatsApp.",
        type: "checkbox",
        options: opts("resp_ch", RESPONSE_CHANNELS),
        allowOtherOption: true,
      },
      {
        key: "price_position",
        title: "Sind die eigenen Preise im Vergleich zu anderen Anbietern eher höher, ähnlich oder niedriger?",
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
        type: "text",
      },
      {
        key: "min_order_value",
        title:
          "Ab welchem ungefähren Auftragswert (in Euro) lohnt sich ein Projekt oder eine Buchung wirklich – und ab welcher Größe wird ein Auftrag eher abgelehnt, weil er zu klein ist?",
        type: "text",
      },
      {
        key: "service_area",
        title:
          "Bis zu welcher Entfernung (z. B. in Kilometern) wird gearbeitet, und gibt es Ausnahmen für besondere Projekte?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_values",
    "Werte & Arbeitsweise",
    [
      {
        key: "daily_priority",
        title: "Was ist bei der täglichen Arbeit am wichtigsten?",
        type: "text",
      },
      {
        key: "quality_assurance",
        title: "Woran wird gemerkt, dass ein Ziel erreicht wurde und die Qualität stimmt?",
        type: "text",
      },
      {
        key: "unexpected_challenges",
        title: "Wie wird reagiert, wenn während eines Projekts etwas Unerwartetes passiert oder sich etwas ändert?",
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
        type: "text",
      },
      {
        key: "customer_values",
        title:
          "Welche der folgenden Werte sind im Umgang mit Kunden am wichtigsten – bitte in eine Reihenfolge bringen.",
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
        key: "company_voice",
        title: "Wird in Texten über die eigene Firma eher „Wir“ gesagt, oder wird der Firmenname direkt genannt?",
        type: "radio",
        options: opts("voice", COMPANY_VOICE),
      },
      {
        key: "jargon_level",
        title: "Wie viele Fachbegriffe dürfen in Texten vorkommen?",
        type: "radio",
        options: opts("jargon", JARGON_LEVEL),
      },
      {
        key: "text_length",
        title: "Sollen Texte eher kurz und knapp sein, oder ausführlich mit vielen Details?",
        type: "radio",
        options: opts("textlen", TEXT_LENGTH),
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
        key: "tone_reference_texts",
        title: "Gibt es bereits vorhandene Texte, deren Tonfall besonders gut passt? Bitte Link oder Beispiel angeben.",
        type: "text",
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
        title: "Welche Ausbildungen, Zertifikate oder Auszeichnungen gibt es im Team oder in der Firma?",
        description: "Ein Eintrag pro Ausbildung oder Zertifikat.",
        type: "text_list",
        options: emptySlots("quali", 3),
        allowExtraEntries: true,
        addEntryLabel: "Eintrag hinzufügen",
      },
      {
        key: "company_history",
        title: "Seit wann gibt es die Firma, und was waren die wichtigsten Meilensteine seitdem?",
        description: "Pro Meilenstein: Jahr und Ereignis, z. B. 2018 – Firma gegründet.",
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
    "Erfolge, Bewertungen & belegbare Zahlen",
    [
      {
        key: "impressive_results",
        title:
          "Was sind die beeindruckendsten Ergebnisse, die mit Kunden erreicht wurden? Bitte mit konkreten Zahlen, falls vorhanden (z. B. „20 kg abgenommen“, „Umsatz um 30 % gesteigert“).",
        description: "Ein Ergebnis pro Feld.",
        type: "text_list",
        options: emptySlots("result", 3),
        allowExtraEntries: true,
        addEntryLabel: "Ergebnis hinzufügen",
      },
      {
        key: "testimonials",
        title: "Gibt es Aussagen von Kunden, die die eigene Arbeit besonders gut beschreiben? Bitte wortwörtlich.",
        description: "Pro Zitat: der Satz und optional Name oder Quelle.",
        type: "text_list",
        options: emptySlots("quote", 3),
        allowExtraEntries: true,
        addEntryLabel: "Zitat hinzufügen",
      },
      {
        key: "fan_moment",
        title: "Wann genau merkt man, dass ein Kunde zum echten Fan geworden ist? Was war der entscheidende Moment?",
        type: "text",
      },
      {
        key: "why_stay",
        title: "Aus welchem Grund bleiben Kunden langfristig, statt nach einem Projekt oder Kauf wegzubleiben?",
        type: "text",
      },
      {
        key: "years_staff_customers",
        title:
          "Seit wie vielen Jahren gibt es die Firma, und wie viele Kunden bzw. Mitarbeitende gab oder gibt es ungefähr? Bitte möglichst konkrete Zahlen.",
        type: "text",
        prefillHint: "years_staff",
      },
      {
        key: "proven_metrics",
        title:
          "Welche konkreten Erfolgszahlen können genannt werden? Bitte nur Zahlen, die tatsächlich stimmen und belegt werden können.",
        description: "Pro Kennzahl: Bezeichnung und Wert, z. B. Anzahl abgeschlossener Projekte – über 300.",
        type: "text_list",
        options: emptySlots("metric", 3),
        allowExtraEntries: true,
        addEntryLabel: "Kennzahl hinzufügen",
        prefillHint: "seo_metrics",
      },
      {
        key: "certificates_links",
        title:
          "Welche Zertifikate, Auszeichnungen oder Mitgliedschaften gibt es, und gibt es dazu einen Link oder ein Dokument als Nachweis?",
        description: "Pro Zertifikat: Bezeichnung und Link oder Dokumentname.",
        type: "text_list",
        options: emptySlots("cert", 3),
        allowExtraEntries: true,
        addEntryLabel: "Zertifikat hinzufügen",
      },
      {
        key: "public_use_permission",
        title:
          "Dürfen Geschichten, Zitate oder Zahlen von echten Kunden öffentlich verwendet werden – zum Beispiel auf der Website? Mit vollem Namen, oder nur ohne Namen?",
        type: "radio",
        options: opts("public_use", PUBLIC_USE),
      },
      {
        key: "public_use_details",
        title: "Details dazu, falls nötig",
        type: "text",
      },
      {
        key: "image_assets",
        title:
          "Gibt es Fotos, die im Marketing verwendet werden dürfen (z. B. Vorher-Nachher-Fotos, Fotos vom Team, Fotos vom Arbeitsprozess)?",
        type: "checkbox",
        options: opts("img", IMAGE_ASSETS),
        allowOtherOption: true,
      },
      {
        key: "image_assets_notes",
        title: "Links oder Hinweise zu diesen Fotos oder Dateien",
        description: "Upload im Fragebogen ist nicht möglich – bitte Links oder Dateinamen eintragen.",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_market",
    "Bekanntheit & Auffindbarkeit im Internet",
    [
      {
        key: "competitors_respected",
        title: "Welche anderen Anbieter werden respektiert, und warum?",
        type: "text",
        prefillHint: "good_competitors",
      },
      {
        key: "competitors_better",
        title: "Was machen andere Anbieter ehrlich gesagt besser?",
        type: "text",
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
          "Diese Wörter werden intern „Fokus-Keywords“ genannt. Ein Wort oder eine Wortgruppe pro Feld.",
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
        description: "Ein Wort oder eine Wortgruppe pro Feld.",
        type: "text_list",
        options: emptySlots("kw_problem", 3),
        allowExtraEntries: true,
        addEntryLabel: "Wort hinzufügen",
      },
      {
        key: "keyword_place",
        title: "Mit welchem Ort zusammen soll die Firma gefunden werden (z. B. „Zahnarzt Düsseldorf“)?",
        description: "Ein Ort oder eine Kombination pro Feld.",
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
        key: "external_mentions",
        title:
          "Wird die Firma irgendwo im Internet erwähnt, ohne dass selbst etwas dafür getan wurde – z. B. in einer Zeitung, auf einer Fachseite oder in einem Verzeichnis?",
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
      {
        key: "automation_goals",
        title: "Welche Abläufe sollen zukünftig einfacher oder automatisch laufen?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_hormozi",
    "Wünsche und Hürden des Kunden",
    [
      {
        key: "hormozi_dream",
        title:
          "Was ist der eigentliche Wunsch des Kunden – wie soll sich sein Leben oder Alltag anfühlen, nachdem die Zusammenarbeit erfolgreich war? Bitte nicht die eigene Leistung beschreiben, sondern das Ergebnis für den Kunden.",
        type: "text",
        prefillHint: "target_group",
      },
      {
        key: "hormozi_pain",
        title: "Was ist das größte Problem oder die größte Sorge des Kunden, bevor er sich entscheidet?",
        type: "text",
      },
      {
        key: "hormozi_proof",
        title:
          "Was überzeugt den Kunden am Ende, diese Sorge loszulassen (z. B. ein Beweis, eine Erfahrung, ein Ergebnis)?",
        type: "text",
      },
      {
        key: "hormozi_urgency",
        title: "Warum sollte sich der Kunde jetzt entscheiden und nicht erst in ein paar Monaten?",
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
        title: "Wie lässt sich die Firma in drei bis fünf Sätzen beschreiben?",
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
    "core_persona_intro",
    "Einleitung",
    [
      {
        key: "persona_confirm_real_experience",
        title:
          "Bestätigung, dass alle folgenden Angaben auf eigenen, echten Erfahrungen und Beobachtungen beruhen.",
        description: "Bitte mit Ja oder Nein antworten. Ohne diese Bestätigung ist der Fragebogen nicht auswertbar.",
        required: true,
        type: "radio",
        options: YES_NO,
      },
    ],
    "Dieser Fragebogen beschreibt den idealen Kunden – die Art von Person oder Firma, mit der die Zusammenarbeit am besten funktioniert.",
  ),
  ...step(
    "core_persona_avatar",
    "Wer ist der Wunschkunde",
    [
      {
        key: "persona_name",
        title:
          "Wie könnte dieser ideale Kunde heißen, wenn es eine echte Person wäre (Vor- und Nachname)? Das dient nur der besseren Vorstellung, es handelt sich nicht um eine echte Person.",
        required: true,
        type: "text",
        prefillHint: "persona_name",
      },
      {
        key: "persona_description",
        title:
          "Wie lässt sich dieser ideale Kunde in drei bis fünf Sätzen beschreiben (ungefähres Alter, Lebenssituation, warum die Zusammenarbeit mit ihm besonders gut funktioniert)?",
        required: true,
        type: "text",
      },
      {
        key: "persona_customer_groups",
        title: "Gibt es unterschiedliche Gruppen von Kunden, oder ist es meistens derselbe Typ Mensch?",
        description: "Liste vor Versand passend zur Branche ersetzen.",
        type: "checkbox",
        options: opts("persona_group", PERSONA_CUSTOMER_GROUP_PLACEHOLDERS),
        allowOtherOption: true,
      },
    ],
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
        description: "Optionen vor Versand neu erstellen. Preisbereiche unterscheiden sich stark je Branche.",
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
        type: "text",
      },
      {
        key: "persona_goals",
        title:
          "Was will dieser Kunde zu Beginn der Zusammenarbeit am meisten erreichen? Bitte nach Häufigkeit sortieren.",
        description: "Optionen vor Versand passend zur Branche eintragen.",
        type: "ranking",
        options: opts("persona_goal", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "persona_pain",
        title:
          "Wie beschreibt dieser Kunde sein eigenes Problem im ersten Gespräch – am besten mit den genauen Worten, die tatsächlich verwendet wurden?",
        required: true,
        type: "text",
        prefillHint: "persona_pain",
      },
      {
        key: "persona_unspoken_drivers",
        title:
          "Was treibt diesen Kunden innerlich an, oder wovor hat er Angst, auch wenn er es nicht direkt ausspricht?",
        type: "text",
      },
      {
        key: "persona_past_frustrations",
        title:
          "Gab es schlechte Erfahrungen mit früheren Lösungen, anderen Anbietern oder eigenen Versuchen? Was wurde darüber gesagt?",
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
        description: "Ein Satz pro Feld.",
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
        type: "radio",
        options: PERSONA_RESEARCH_ACTIVITY,
      },
      {
        key: "persona_research_how",
        title: "Wie genau sieht diese Suche aus?",
        type: "text",
      },
      {
        key: "persona_website_missing",
        title: "Was hat dieser Kunde auf der eigenen Website vermisst oder nicht gefunden?",
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
        description: "Optionen vor Versand passend zur Branche eintragen.",
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
        key: "persona_delay_reaction",
        title: "Wie reagiert dieser Kunde, wenn sich ein Termin verschiebt?",
        type: "radio",
        options: PERSONA_DELAY_REACTION,
      },
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
        title: "Wie reagiert dieser Kunde, wenn während der Zusammenarbeit etwas Unerwartetes passiert?",
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
        type: "ranking",
        options: opts("persona_source", PERSONA_INFO_SOURCES),
        allowExtraEntries: true,
      },
      {
        key: "persona_reviews_mentioned",
        title: "Werden Google-Bewertungen erwähnt? Was wird dazu gesagt?",
        type: "text",
      },
      {
        key: "persona_research_signs",
        title:
          "Woran merkt man, dass dieser Kunde sich vorher schon online informiert hat? Was wird dann gesagt oder gefragt?",
        type: "text",
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
        key: "persona_pre_contact_fears",
        title: "Welche konkreten Sorgen oder Ängste werden vor dem ersten Kontakt geäußert? Bitte wortwörtlich.",
        description: "Eine Sorge pro Feld.",
        type: "text_list",
        options: emptySlots("persona_fear", 3),
        allowExtraEntries: true,
        addEntryLabel: "Sorge hinzufügen",
      },
      {
        key: "persona_hold_back",
        title:
          "Was hält diesen Kunden davon ab, sich zu melden, obwohl eigentlich Interesse besteht (z. B. Angst vor den Kosten, Zeitmangel, Unsicherheit ob das Angebot passt, schlechte frühere Erfahrung)?",
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
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_journey",
    "Der Weg vom ersten Kontakt zur Stammkundschaft",
    [
      {
        key: "persona_journey_steps",
        title:
          "Wie sieht der typische Weg aus, von dem Moment, in dem dieser Kunde zum ersten Mal von dem Angebot erfährt, bis er zum festen Kunden wird?",
        description: "Ein Schritt pro Feld. Die Felder sind durchnummeriert.",
        type: "text_list",
        options: emptySlots("persona_step", 3),
        allowExtraEntries: true,
        addEntryLabel: "Schritt hinzufügen",
      },
      {
        key: "persona_journey_duration",
        title: "Wie lange dauert jeder dieser Schritte ungefähr?",
        type: "text",
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
        description: "Optionen vor Versand passend zur Branche eintragen.",
        type: "ranking",
        options: opts("persona_alt", INDUSTRY_RANKING_PLACEHOLDERS),
        allowExtraEntries: true,
      },
      {
        key: "persona_compared_with",
        title: "Womit wird das eigene Angebot konkret verglichen?",
        type: "text",
      },
    ],
  ),
  ...step(
    "core_persona_aftercare",
    "Nach dem Abschluss",
    [
      {
        key: "persona_return_behavior",
        title: "Kommt dieser Kunde nach einem erfolgreichen Abschluss zurück? Was ändert sich danach im Verhalten?",
        type: "text",
      },
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
        type: "text",
      },
      {
        key: "persona_hormozi_trigger",
        title: "Was war der Auslöser dafür, überhaupt aktiv zu werden?",
        type: "text",
      },
      {
        key: "persona_hormozi_speed",
        title: "Wie schnell erwartet dieser Kunde ein erstes sichtbares Ergebnis?",
        type: "text",
      },
      {
        key: "persona_hormozi_urgency",
        title: "Warum sollte sich dieser Kunde jetzt entscheiden und nicht erst später?",
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
      {
        key: "persona_summary",
        title:
          "Wie lässt sich dieser Kunde in drei bis fünf Sätzen so beschreiben, dass sofort klar ist, wer gemeint ist?",
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

/** TEIL C – interner Agentur-Block (nicht an den Kunden). */
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
