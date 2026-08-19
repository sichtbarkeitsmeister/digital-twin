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
  | "persona_pain";

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
  prefillHint?: CoreQuestionPrefillHint;
};

function opt(id: string, label: string): SurveyOption {
  return { id, label };
}

function opts(prefix: string, labels: string[]): SurveyOption[] {
  return labels.map((label, index) => opt(`${prefix}_${index + 1}`, label));
}

const YES_NO: SurveyOption[] = [opt("ja", "Ja"), opt("nein", "Nein")];

const PORTFOLIO_PLACEHOLDERS = [
  "Angebotsbereich 1 (vor Versand branchenbezogen ersetzen)",
  "Angebotsbereich 2 (vor Versand branchenbezogen ersetzen)",
  "Angebotsbereich 3 (vor Versand branchenbezogen ersetzen)",
  "Angebotsbereich 4 (vor Versand branchenbezogen ersetzen)",
];

const COMPANY_ARCHETYPES = [
  "Der Visionär",
  "Der Experte",
  "Der Kümmerer",
  "Der Verlässliche",
  "Der Innovator",
  "Der Perfektionist",
];

const RESPONSE_SPEED = [
  "Unter 2 Stunden",
  "Innerhalb 24 Std.",
  "Innerhalb 48 Std.",
  "Länger",
];

const RESPONSE_CHANNELS = [
  "Telefon",
  "E-Mail",
  "WhatsApp",
  "Kontaktformular",
  "Persönlich vor Ort",
];

const PRICE_POSITION = [
  "Premium-Segment",
  "Mittleres Segment",
  "Einstiegssegment",
  "Eigene Kategorie – nicht vergleichbar",
];

const PRICE_COMMUNICATION = [
  "Offen auf der Website",
  "Erst nach Erstgespräch",
  "Gestaffelt sichtbar",
];

const VOLUME_VS_DEPTH = [
  "Mehr Kundschaft",
  "Mehr Tiefe pro Auftrag",
  "Beides gleichwertig",
];

const CUSTOMER_VALUES = [
  "Individualität",
  "Nachhaltigkeit",
  "Vertrauen",
  "Ehrlichkeit",
  "Qualität",
  "Termintreue",
  "Innovation",
];

const SPEAKING_STYLES = [
  "Persönlich und herzlich",
  "Direkt und lösungsorientiert",
  "Beruhigend und einfühlsam",
  "Kompetent und fachlich",
];

const COMPANY_VOICE = [
  "Wir von [Name]",
  "Markenname direkt",
  "Ich-Form bei Einzelunternehmer",
];

const JARGON_LEVEL = [
  "Keine Fachsprache",
  "Fachkompetenz zeigen, aber immer erklären",
  "Hoher Fachanteil",
];

const TEXT_LENGTH = [
  "Kurz und prägnant",
  "Ausführlich und detailliert",
  "Je nach Kanal unterschiedlich",
];

const PUBLIC_USE = [
  "Mit Namensnennung",
  "Nur anonymisiert",
  "Je nach Beispiel unterschiedlich",
];

const IMAGE_ASSETS = [
  "Vorher-Nachher-Fotos",
  "Teamfotos",
  "Prozessfotos",
  "Videos",
  "Keines vorhanden",
];

const ATTENTION_CHANNELS = [
  "Empfehlung",
  "Google-Suche",
  "Social Media",
  "Website direkt",
  "Print",
  "Partnerschaften",
  "Vor Ort",
];

const ONLINE_CHANNELS = [
  "Website",
  "Instagram",
  "Facebook",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Newsletter",
  "Google Ads",
];

const NAP_CONSISTENCY = [
  "Ja, konsistent",
  "Nein, es gibt Abweichungen",
  "Nicht geprüft",
];

const PROCESS_STEPS = ["Schritt 1", "Schritt 2", "Schritt 3", "Schritt 4"];

const COMPETITOR_SLOTS = [
  "Mitbewerber 1 (Name, Website, kurze Begründung)",
  "Mitbewerber 2 (Name, Website, kurze Begründung)",
  "Mitbewerber 3 (Name, Website, kurze Begründung)",
  "Mitbewerber 4 (Name, Website, kurze Begründung)",
  "Mitbewerber 5 (Name, Website, kurze Begründung)",
];

const KEYWORD_SLOTS = [
  "Marken- und Angebotsbegriffe",
  "Problembegriffe",
  "Ortsbegriffe",
];

/** Fixed basis for Anbieter (SEO-/Firmenwissen) questionnaires. */
export const ANBIETER_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  {
    key: "confirm_real_experience",
    stepId: "core_intro",
    stepTitle: "Einleitung",
    stepDescription: "Nur Angaben auf Basis echter Erfahrungen.",
    title:
      "Bestätigst du, dass alle folgenden Angaben auf Basis echter Erfahrungen erfolgen?",
    description: "Ohne diese Bestätigung ist der Fragebogen nicht auswertbar.",
    required: true,
    type: "radio",
    options: YES_NO,
  },

  {
    key: "company_name",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    stepDescription: "Name, Standort, Angebot und Alleinstellung.",
    title: "Wie lautet der vollständige Unternehmensname inklusive Rechtsform?",
    description: "Rechtlicher Name, z. B. GmbH, UG, e. K.",
    required: true,
    type: "text",
    prefillHint: "org_name",
  },
  {
    key: "colloquial_name",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title:
      "Wie wird das Unternehmen umgangssprachlich genannt – von Kundschaft, Team und Partnern?",
    description: "Kurzname, Markenname im Alltag, Spitzname.",
    required: false,
    type: "text",
  },
  {
    key: "location_catchment",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title:
      "Wo befindet sich der Hauptstandort, und aus welchem Einzugsgebiet stammt der Großteil der Kundschaft?",
    description: "Ort plus typisches Einzugsgebiet.",
    required: false,
    type: "text",
    prefillHint: "region",
  },
  {
    key: "portfolio",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Welche Angebotsbereiche gehören aktuell zum Portfolio?",
    description:
      "Optionen vor Versand für die Branche ersetzen. „Sonstiges“ bleibt als Freitext.",
    required: false,
    type: "checkbox",
    options: opts("portfolio", PORTFOLIO_PLACEHOLDERS),
    allowOtherOption: true,
    prefillHint: "services",
  },
  {
    key: "known_for",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Wofür ist das Unternehmen in der Region bekannt?",
    description: "Der Ruf vor Ort – nicht die interne Selbstbeschreibung.",
    required: false,
    type: "text",
    prefillHint: "focus",
  },
  {
    key: "usp",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title:
      "Was sind die wichtigsten Alleinstellungsmerkmale (USP) im Vergleich zu anderen Anbietern der Region?",
    description: "USPs sind individuell – bitte in eigenen Worten, keine Standardfloskeln.",
    required: false,
    type: "text",
    prefillHint: "usp",
  },
  {
    key: "competitor_gap",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title:
      "Was kann das Unternehmen, das Mitbewerber in der Region nicht können oder nicht anbieten?",
    description: "Konkrete Lücke im Markt, nicht allgemeines Qualitätsversprechen.",
    required: false,
    type: "text",
  },
  {
    key: "company_archetype",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Welcher Unternehmens-Typ trifft am ehesten zu?",
    description:
      "Bitte in die Reihenfolge bringen: am meisten zutreffend zuerst. Eigene Typen ergänzen, falls nötig.",
    required: false,
    type: "ranking",
    options: opts("archetype", COMPANY_ARCHETYPES),
    allowCustomEntries: true,
  },

  {
    key: "services_ranked",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    stepDescription: "Buchungen, Ablauf, Reaktion, Preis und Einzugsgebiet.",
    title:
      "Welche Leistungen oder Angebote werden am häufigsten gebucht oder nachgefragt?",
    description:
      "Vor Versand die Optionen aus den Angebotsbereichen übernehmen und branchenbezogen benennen. Reihenfolge: am häufigsten zuerst.",
    required: false,
    type: "ranking",
    options: opts("svc_rank", PORTFOLIO_PLACEHOLDERS),
    allowCustomEntries: true,
  },
  {
    key: "typical_process",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title:
      "Wie läuft ein typischer Ablauf von der ersten Anfrage bis zum Abschluss – bitte einzelne Schritte beschreiben.",
    description: "Ein Schritt pro Zeile. Weitere Schritte ergänzen.",
    required: false,
    type: "text_list",
    options: opts("process", PROCESS_STEPS),
    allowExtraEntries: true,
  },
  {
    key: "response_speed",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title: "Wie schnell erfolgt im Durchschnitt eine Reaktion auf eine neue Anfrage?",
    description: "Typische Erstreaktion, nicht der Bestfall.",
    required: false,
    type: "radio",
    options: opts("resp_speed", RESPONSE_SPEED),
  },
  {
    key: "response_channels",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title: "Über welche Kanäle wird typischerweise reagiert?",
    description: "Mehrere Kanäle möglich.",
    required: false,
    type: "checkbox",
    options: opts("resp_ch", RESPONSE_CHANNELS),
    allowOtherOption: true,
  },
  {
    key: "price_position",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title: "Wie positioniert sich das Unternehmen preislich im Vergleich zu Mitbewerbern?",
    description: "",
    required: false,
    type: "radio",
    options: opts("price_pos", PRICE_POSITION),
  },
  {
    key: "price_communication",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title: "Wie werden Preise kommuniziert?",
    description: "",
    required: false,
    type: "radio",
    options: opts("price_com", PRICE_COMMUNICATION),
  },
  {
    key: "price_communication_reason",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title: "Aus welchem Grund wird die Preis-Kommunikation so gehandhabt?",
    description: "Kurze Begründung zur vorherigen Auswahl.",
    required: false,
    type: "text",
  },
  {
    key: "min_order_value",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title:
      "Ab welchem Auftragswert ist ein Projekt oder eine Buchung interessant, und wo liegt die Grenze für eine Ablehnung?",
    description: "Konkrete Zahl, falls vorhanden.",
    required: false,
    type: "text",
  },
  {
    key: "service_area",
    stepId: "core_offer",
    stepTitle: "Leistungen & Prozess",
    title:
      "In welchem Umkreis oder Einzugsgebiet wird gearbeitet, und gibt es Ausnahmen für besondere Projekte?",
    description: "Regel-Einzugsgebiet plus Ausnahmen.",
    required: false,
    type: "text",
  },

  {
    key: "daily_priority",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    stepDescription: "Woran sich Alltag, Qualität und Kundenwahl ausrichten.",
    title: "Was steht bei der täglichen Arbeit im Vordergrund?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "quality_assurance",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    title: "Wie wird sichergestellt, dass Zielerreichung und Qualität stimmen?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "unexpected_challenges",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    title:
      "Wie wird mit unerwarteten Herausforderungen oder Änderungen während eines laufenden Projekts umgegangen?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "volume_vs_depth",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    title:
      "Was ist wichtiger: eine hohe Anzahl an Kundschaft oder maximale Tiefe bei jedem einzelnen Auftrag?",
    description: "",
    required: false,
    type: "radio",
    options: opts("vol_depth", VOLUME_VS_DEPTH),
  },
  {
    key: "no_fit_clients",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    title:
      "Mit welchen Kundentypen oder Projekten wird ungern zusammengearbeitet – bei welchen Erwartungen heißt es klar „Das passt nicht“?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "customer_values",
    stepId: "core_values",
    stepTitle: "Werte, Philosophie & Abgrenzung",
    title: "Welche Werte prägen den Umgang mit Kundschaft im Alltag?",
    description:
      "Reihenfolge: am prägendsten zuerst. Weitere Werte können ergänzt werden.",
    required: false,
    type: "ranking",
    options: opts("values", CUSTOMER_VALUES),
    allowCustomEntries: true,
  },

  {
    key: "speaking_style",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    stepDescription: "Wie das Unternehmen spricht – intern wie im Marketing.",
    title: "Wie wird normalerweise mit Kundschaft gesprochen?",
    description: "Reihenfolge: am typischsten zuerst.",
    required: false,
    type: "ranking",
    options: opts("tone", SPEAKING_STYLES),
    allowCustomEntries: true,
  },
  {
    key: "address_form",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Welche Anredeform wird in Marketingtexten verwendet?",
    description: "Du/Sie als Inhalt der Marketingtexte, nicht als Anrede hier im Fragebogen.",
    required: false,
    type: "radio",
    options: [opt("du", "Du"), opt("sie", "Sie")],
  },
  {
    key: "company_voice",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Wie wird über das Unternehmen selbst gesprochen, wenn ein Text darüber verfasst wird?",
    description: "",
    required: false,
    type: "radio",
    options: opts("voice", COMPANY_VOICE),
  },
  {
    key: "jargon_level",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Wie viel Fachsprache soll in Texten verwendet werden?",
    description: "",
    required: false,
    type: "radio",
    options: opts("jargon", JARGON_LEVEL),
  },
  {
    key: "text_length",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Sollen Texte eher kurz und prägnant oder ausführlich und detailliert sein?",
    description: "",
    required: false,
    type: "radio",
    options: opts("length", TEXT_LENGTH),
  },
  {
    key: "typical_terms",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title:
      "Welche Begriffe oder Formulierungen sind typisch und sollen konsequent verwendet werden?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "forbidden_terms",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Welche Begriffe oder Formulierungen sollen im Marketing niemals verwendet werden?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "tone_reference_texts",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title: "Gibt es bereits bestehende Texte, die vom Ton her besonders gut passen?",
    description: "Links oder Titel von Seiten, PDFs, Posts.",
    required: false,
    type: "text",
  },
  {
    key: "philosophy_quotes",
    stepId: "core_tone",
    stepTitle: "Sprache & Tonalität",
    title:
      "Gibt es Aussagen der Geschäftsführung oder des Teams, die die Philosophie auf den Punkt bringen?",
    description: "Bitte wörtlich, in Anführungszeichen.",
    required: false,
    type: "text",
  },

  {
    key: "team_members",
    stepId: "core_team",
    stepTitle: "Team & Expertise",
    stepDescription: "Menschen, Qualifikation, Geschichte und Partner.",
    title: "Wer gehört zum Team, und welche Rollen und Zuständigkeiten gibt es?",
    description: "Namen und Aufgaben, inkl. Inhaber / Geschäftsführung.",
    required: false,
    type: "text",
    prefillHint: "owner_name",
  },
  {
    key: "qualifications",
    stepId: "core_team",
    stepTitle: "Team & Expertise",
    title: "Welche Qualifikationen, Zertifikate oder Auszeichnungen liegen vor?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "company_history",
    stepId: "core_team",
    stepTitle: "Team & Expertise",
    title: "Seit wann besteht das Unternehmen, und welche wichtigen Meilensteine gab es seither?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "partners_suppliers",
    stepId: "core_team",
    stepTitle: "Team & Expertise",
    title:
      "Mit welchen Partnern, Netzwerken oder Lieferanten wird zusammengearbeitet, und aus welchem Grund?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "impressive_results",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    stepDescription: "Nur Belege, die wirklich stimmen und genutzt werden dürfen.",
    title:
      "Was sind die eindrucksvollsten Ergebnisse oder Transformationen, die mit Kundschaft erreicht wurden – bitte mit konkreten Zahlen, sofern vorhanden?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "testimonials",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Gibt es Kundenzitate oder Bewertungen, die das Unternehmen besonders gut beschreiben?",
    description: "Bitte wörtlich.",
    required: false,
    type: "text",
  },
  {
    key: "fan_moment",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Wann wird aus Kundschaft ein echter Fan? Was war jeweils der entscheidende Moment?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "why_stay",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Aus welchem Grund bleibt Kundschaft langfristig?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "years_staff_customers",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title:
      "Seit wie vielen Jahren besteht das Unternehmen, und wie viele Mitarbeitende bzw. wie viel Kundschaft wurden seither betreut?",
    description: "Konkrete Zahlen, falls belegt.",
    required: false,
    type: "text",
    prefillHint: "employee_count",
  },
  {
    key: "proven_metrics",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title:
      "Welche nachweisbaren Erfolgszahlen gibt es – nur Angaben, die tatsächlich belegt oder dokumentiert sind?",
    description: "Keine Schätzungen oder Wunschzahlen.",
    required: false,
    type: "text",
  },
  {
    key: "certificates_links",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title:
      "Welche Zertifikate, Auszeichnungen oder Mitgliedschaften liegen vor, und gibt es dazu einen Nachweis-Link?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "public_use_permission",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Welche Fallbeispiele, Zitate oder Zahlen dürfen öffentlich verwendet werden?",
    description: "",
    required: false,
    type: "radio",
    options: opts("public_use", PUBLIC_USE),
  },
  {
    key: "public_use_details",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Details oder Ausnahmen zur öffentlichen Nutzung je Beispiel",
    description: "Welche Beispiele mit Namen, welche nur anonym.",
    required: false,
    type: "text",
  },
  {
    key: "image_assets",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Gibt es Bildmaterial mit Nutzungsrecht für Marketing und Content?",
    description:
      "Dateien können später im Ordner ergänzt werden. Hier Art des Materials markieren.",
    required: false,
    type: "checkbox",
    options: opts("img", IMAGE_ASSETS),
    allowOtherOption: true,
  },
  {
    key: "image_assets_notes",
    stepId: "core_proof",
    stepTitle: "Erfolgsgeschichten, Vertrauenssignale & belegbare Fakten",
    title: "Links, Speicherort oder Hinweise zum Bildmaterial",
    description: "Drive-Ordner, Website-Galerie, Dateinamen.",
    required: false,
    type: "text",
  },

  {
    key: "competitors_respected",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    stepDescription: "Wettbewerb, Auffindbarkeit und Wahrnehmung.",
    title: "Welche Mitbewerber werden respektiert, und aus welchem Grund?",
    description: "",
    required: false,
    type: "text",
    prefillHint: "good_competitors",
  },
  {
    key: "competitors_better",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Was machen Mitbewerber ehrlich gesagt besser?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "competitors_top",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Welche drei bis fünf Mitbewerber gelten als die wichtigsten – bitte jeweils Name, Website und kurze Begründung.",
    description: "Eine Zeile pro Mitbewerber.",
    required: false,
    type: "text_list",
    options: opts("comp_top", COMPETITOR_SLOTS),
    allowExtraEntries: false,
    prefillHint: "competitors",
  },
  {
    key: "attention_channels",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Wie wird Neukundschaft auf das Unternehmen aufmerksam?",
    description: "Reihenfolge: am häufigsten zuerst. Weitere Kanäle ergänzen.",
    required: false,
    type: "ranking",
    options: opts("attn", ATTENTION_CHANNELS),
    allowCustomEntries: true,
  },
  {
    key: "focus_keywords",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Unter welchen Wörtern oder Begriffen soll das Unternehmen bei Google gefunden werden (Fokus-Keywords)?",
    description: "Getrennt nach Marken-/Angebotsbegriffen, Problembegriffen und Ortsbegriffen.",
    required: false,
    type: "text_list",
    options: opts("kw", KEYWORD_SLOTS),
    allowExtraEntries: true,
  },
  {
    key: "online_channels",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Welche Online-Kanäle werden aktuell aktiv bespielt?",
    description: "Nur Kanäle, die wirklich gepflegt werden.",
    required: false,
    type: "checkbox",
    options: opts("online", ONLINE_CHANNELS),
    allowOtherOption: true,
  },
  {
    key: "seasonal_yesno",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Gibt es saisonale Muster, also bestimmte Zeiträume mit deutlich mehr oder weniger Anfragen?",
    description: "",
    required: false,
    type: "radio",
    options: YES_NO,
  },
  {
    key: "seasonal_details",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Falls ja: welche Zeiträume, und was ist der Grund?",
    description: "Bei „Nein“ leer lassen.",
    required: false,
    type: "text",
  },
  {
    key: "ai_search_yesno",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Wurde die Marke schon einmal bewusst in ChatGPT, Perplexity oder einem ähnlichen KI-System gesucht?",
    description:
      "Falls nein: kein Problem, das wird im Rahmen der KI-Recherche ohnehin geprüft.",
    required: false,
    type: "radio",
    options: YES_NO,
  },
  {
    key: "ai_search_result",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Falls ja: mit welchem Ergebnis?",
    description: "Bei „Nein“ leer lassen.",
    required: false,
    type: "text",
  },
  {
    key: "nap_consistency",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Sind Firmenname, Adresse und Telefonnummer auf allen Plattformen identisch angegeben (Google-Unternehmensprofil, Website, Branchenverzeichnisse)?",
    description: "Falls unklar: auch das wird eigenständig geprüft.",
    required: false,
    type: "radio",
    options: opts("nap", NAP_CONSISTENCY),
  },
  {
    key: "nap_deviations",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Falls Abweichungen bekannt sind: welche?",
    description: "Bei konsistenten Angaben leer lassen.",
    required: false,
    type: "text",
  },
  {
    key: "external_mentions",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title:
      "Gibt es bekannte externe Erwähnungen der Marke, z. B. in der Presse, auf Fachportalen oder in Branchenverzeichnissen?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "desired_perception",
    stepId: "core_market",
    stepTitle: "Marktposition, Wettbewerb & SEO/GEO-Sichtbarkeit",
    title: "Wie soll das Unternehmen heute und in Zukunft wahrgenommen werden?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "three_year_goal",
    stepId: "core_future",
    stepTitle: "Zukunft & Strategie",
    stepDescription: "Richtung der nächsten Jahre, nicht der Tagesgeschäft-Wünsche.",
    title: "Wo soll das Unternehmen in zwei bis drei Jahren stehen?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "marketing_12_months",
    stepId: "core_future",
    stepTitle: "Zukunft & Strategie",
    title: "Welche Marketingmaßnahmen sind für die nächsten zwölf Monate geplant oder gewünscht?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "automation_goals",
    stepId: "core_future",
    stepTitle: "Zukunft & Strategie",
    title:
      "Welche Abläufe sollen künftig durch Digitalisierung oder Automatisierung vereinfacht werden?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "hormozi_dream",
    stepId: "core_hormozi",
    stepTitle: "Hormozi-Layer",
    stepDescription:
      "Zielzustand, Hürde, Beweis und Dringlichkeit der Zielgruppe – nicht die Leistungsbeschreibung.",
    title:
      "Was ist das eigentliche Traumziel der Zielgruppe – also der Zustand nach der Zusammenarbeit, nicht die Leistung selbst?",
    description: "",
    required: false,
    type: "text",
    prefillHint: "target_group",
  },
  {
    key: "hormozi_pain",
    stepId: "core_hormozi",
    stepTitle: "Hormozi-Layer",
    title: "Was ist der Hauptschmerz oder die größte Hürde der Zielgruppe vor der Entscheidung?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "hormozi_proof",
    stepId: "core_hormozi",
    stepTitle: "Hormozi-Layer",
    title: "Welcher Beweis räumt diese Hürde erfahrungsgemäß weg?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "hormozi_urgency",
    stepId: "core_hormozi",
    stepTitle: "Hormozi-Layer",
    title:
      "Aus welchem Grund sollte jetzt und nicht erst in einigen Monaten eine Entscheidung getroffen werden?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "anything_else",
    stepId: "core_closing",
    stepTitle: "Abschluss",
    stepDescription: "Was sonst noch wichtig ist, in eigenen Worten.",
    title: "Gibt es noch etwas Wichtiges über das Unternehmen, das bisher nicht abgefragt wurde?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "elevator_pitch",
    stepId: "core_closing",
    stepTitle: "Abschluss",
    title: "Wie lässt sich das Unternehmen in drei bis fünf Sätzen beschreiben?",
    description: "",
    required: false,
    type: "text",
  },
];

/** Fixed basis for Kunden-Persona (Wunschkunde) questionnaires. */
export const PERSONA_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  {
    key: "persona_name",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Wie heißt der digitale Kunden-Avatar?",
    description: "Vorname / Kurzname der Wunschkunden-Persona.",
    required: true,
    type: "text",
    prefillHint: "persona_name",
  },
  {
    key: "persona_job",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Welche Berufs- oder Lebenssituation hat die Persona typischerweise?",
    description: "Rolle, Alltag, Rahmenbedingungen.",
    required: true,
    type: "text",
    prefillHint: "persona_job",
  },
  {
    key: "persona_age",
    stepId: "core_persona",
    stepTitle: "Persona",
    title: "Welches Alter bzw. welche Altersgruppe passt typischerweise?",
    description: "Altersangabe oder Spanne.",
    required: false,
    type: "text",
    prefillHint: "persona_age",
  },
  {
    key: "persona_pain",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Was beschäftigt die Persona gerade am meisten?",
    description: "Schmerzpunkt / Anlass für den Erstkontakt.",
    required: true,
    type: "text",
    prefillHint: "persona_pain",
  },
  {
    key: "persona_goal",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Was möchte die Persona erreichen?",
    description: "Zielbild / gewünschtes Ergebnis.",
    required: true,
    type: "text",
  },
  {
    key: "persona_criteria",
    stepId: "core_needs",
    stepTitle: "Bedarf & Motivation",
    title: "Wonach sucht sich die Persona einen Anbieter aus?",
    description: "Entscheidungskriterien, Must-haves.",
    required: true,
    type: "text",
  },
];

export function coreQuestionsForPurpose(purpose: SurveyPurpose): CoreQuestionTemplate[] {
  return purpose === "anbieter" ? ANBIETER_CORE_QUESTIONS : PERSONA_CORE_QUESTIONS;
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
      options: options.length ? options : [opt(`${t.key}_1`, "Eintrag 1")],
      allowExtraEntries: t.allowExtraEntries !== false,
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
      allowCustomEntries: t.allowCustomEntries !== false,
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
