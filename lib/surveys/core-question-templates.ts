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
      "Bestätigung, dass alle folgenden Angaben auf Basis echter Erfahrungen erfolgen.",
    description: "Bitte mit Ja oder Nein antworten. Ohne diese Bestätigung ist der Fragebogen nicht auswertbar.",
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
    description:
      "Region und Kreis/Bezirk nennen, nicht nur die Stadt. Plus typisches Einzugsgebiet der Kundschaft.",
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
      "Optionen vor Versand für die Branche ersetzen. „Sonstiges“ bleibt als Freitext. Wenn Leistungsseiten auf der Website existieren, Links eintragen. Flyer, PDFs oder andere Dateien ebenfalls verlinken oder kurz benennen.",
    required: false,
    type: "checkbox",
    options: opts("portfolio", PORTFOLIO_PLACEHOLDERS),
    allowOtherOption: true,
    prefillHint: "services",
  },
  {
    key: "portfolio_links",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Links zu Leistungsseiten, Flyern oder anderen Unterlagen zum Portfolio",
    description:
      "Website-URLs, Drive-/PDF-Links oder Dateinamen. Leer lassen, wenn nichts vorliegt.",
    required: false,
    type: "text",
  },
  {
    key: "other_locations_yesno",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Gibt es neben dem Hauptstandort weitere Standorte?",
    description: "",
    required: false,
    type: "radio",
    options: YES_NO,
  },
  {
    key: "other_locations_details",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Falls ja: welche weiteren Standorte, und welche Rolle haben sie?",
    description: "Bei „Nein“ leer lassen.",
    required: false,
    type: "text",
  },
  {
    key: "locations_planned_yesno",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Ist geplant, weitere Standorte zu eröffnen?",
    description: "",
    required: false,
    type: "radio",
    options: YES_NO,
  },
  {
    key: "locations_planned_details",
    stepId: "core_company",
    stepTitle: "Unternehmen & Positionierung",
    title: "Falls ja: wo, wann, und in welchem Stadium der Planung?",
    description: "Bei „Nein“ leer lassen.",
    required: false,
    type: "text",
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
    title: "Über welche Kanäle wird auf neue Anfragen typischerweise geantwortet?",
    description:
      "Nicht der Eingangskanal der Kundschaft, sondern der Rückkanal des Unternehmens. Beispiel: Anfrage kommt über das Kontaktformular, die Antwort erfolgt per Telefon oder WhatsApp.",
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

const PERSONA_AGE_CLASSES: SurveyOption[] = [
  opt("18_24", "18–24"),
  opt("25_34", "25–34"),
  opt("35_44", "35–44"),
  opt("45_54", "45–54"),
  opt("55_64", "55–64"),
  opt("65plus", "65+"),
  opt("gemischt", "gemischt – in der Bemerkung konkretisieren"),
];

const PERSONA_JOB_RANKING = [
  "Angestellte",
  "Selbstständige / Unternehmer",
  "Freiberufler",
  "Führungskräfte",
  "Rentner / im Ruhestand",
  "Haushalt / Care-Arbeit",
  "Studierende / Auszubildende",
];

const PERSONA_FAMILY = [
  "alleinstehend",
  "in Partnerschaft",
  "Kinder im Haus",
  "Kinder ausgezogen",
  "im Ruhestand",
];

const PERSONA_CUSTOMER_GROUP_PLACEHOLDERS = [
  "[Kundentyp 1 – vor Versand ersetzen, z. B. Erstkäufer]",
  "[Kundentyp 2 – vor Versand ersetzen, z. B. Stammkundschaft]",
  "[Kundentyp 3 – vor Versand ersetzen, z. B. Empfehlungskundschaft]",
  "[Kundentyp 4 – vor Versand ersetzen]",
];

const PERSONA_BUDGET_PLACEHOLDERS = [
  "[Preisspanne 1 – vor Versand branchenspezifisch ersetzen]",
  "[Preisspanne 2 – vor Versand branchenspezifisch ersetzen]",
  "[Preisspanne 3 – vor Versand branchenspezifisch ersetzen]",
  "[Preisspanne 4 – vor Versand branchenspezifisch ersetzen]",
];

const PERSONA_GOAL_PLACEHOLDERS = [
  "[Ziel 1 – vor Versand ersetzen]",
  "[Ziel 2 – vor Versand ersetzen]",
  "[Ziel 3 – vor Versand ersetzen]",
  "[Ziel 4 – vor Versand ersetzen]",
];

const PERSONA_DECISION_INFLUENCERS = [
  "Kundschaft selbst",
  "Partner/in",
  "Familie",
  "Freunde / Bekannte",
  "Fachperson / Berater",
];

const PERSONA_COMPARE_QUOTES: SurveyOption[] = [
  opt("meistens", "meistens"),
  opt("teilweise", "teilweise"),
  opt("selten", "selten"),
  opt("nein", "nein"),
];

const PERSONA_OBJECTION_PLACEHOLDERS = [
  "[Einwand 1 – vor Versand ersetzen]",
  "[Einwand 2 – vor Versand ersetzen]",
  "[Einwand 3 – vor Versand ersetzen]",
  "[Einwand 4 – vor Versand ersetzen]",
];

const PERSONA_RESEARCH_ACTIVITY: SurveyOption[] = [
  opt("sehr_aktiv", "sehr aktiv"),
  opt("selektiv", "selektiv"),
  opt("kaum", "kaum"),
];

const PERSONA_DELAY_REACTION: SurveyOption[] = [
  opt("ruhig", "ruhig, mit Nachfrage zum neuen Termin"),
  opt("ungeduldig", "ungeduldig, erwartet sofortige Erklärung"),
  opt("verstaendnis", "verständnisvoll, solange kommuniziert wird"),
  opt("abbruch", "bricht eher ab oder sucht Alternativen"),
];

const PERSONA_FIRST_MEETING_DETAIL: SurveyOption[] = [
  opt("kurz", "kurz und ergebnisorientiert"),
  opt("mittel", "mittel, mit den wichtigsten Eckdaten"),
  opt("ausfuehrlich", "ausführlich, mit vielen Nachfragen"),
  opt("unterschiedlich", "sehr unterschiedlich je nach Person"),
];

const PERSONA_PERSONAL_LEVEL: SurveyOption[] = [
  opt("entscheidend", "entscheidend"),
  opt("wichtig", "wichtig, aber nicht allein ausschlaggebend"),
  opt("sachlich", "eher sachlich, persönliche Ebene zweitrangig"),
  opt("kaum", "kaum relevant"),
];

const PERSONA_DECISION_STYLE: SurveyOption[] = [
  opt("empfehlung", "folgt meist einer klaren Empfehlung"),
  opt("selbst", "entscheidet selbst nach Abwägung"),
  opt("misch", "erst Empfehlung einholen, dann selbst entscheiden"),
  opt("aufschieben", "schiebt die Entscheidung eher auf"),
];

const PERSONA_COMMUNICATION: SurveyOption[] = [
  opt("wenig", "wenig Kontakt, nur bei Bedarf"),
  opt("regelmaessig", "regelmäßige kurze Updates erwartet"),
  opt("eng", "enger, häufiger Austausch"),
  opt("asynchron", "vor allem schriftlich / asynchron"),
];

const PERSONA_PROBLEM_REACTION: SurveyOption[] = [
  opt("loesung", "lösungsorientiert, solange transparent kommuniziert wird"),
  opt("unruhig", "unruhig, braucht schnelle Rückversicherung"),
  opt("kritisch", "kritisch, hinterfragt Aufwand und Kosten"),
  opt("belastung", "erhöhtes Risiko, dass die Zusammenarbeit belastet wird"),
];

const PERSONA_INFO_SOURCES = [
  "Empfehlung",
  "Google-Bewertungen",
  "Website",
  "Social Media",
  "Presse",
];

const PERSONA_TRUST_SIGNALS = [
  "Erfahrung / Jahre",
  "Zertifikate",
  "Bewertungen",
  "Referenzen",
  "persönlicher Eindruck",
];

const PERSONA_HOLD_BACK = [
  "Preis-Angst",
  "Zeitmangel",
  "Unsicherheit, ob passend",
  "schlechte frühere Erfahrung",
];

const PERSONA_ALTERNATIVE_PLACEHOLDERS = [
  "[Alternative 1 – vor Versand ersetzen]",
  "[Alternative 2 – vor Versand ersetzen]",
  "[Alternative 3 – vor Versand ersetzen]",
  "[Alternative 4 – vor Versand ersetzen]",
];

const PERSONA_PRAISE = [
  "Qualität",
  "Kommunikation",
  "Preis-Leistung",
  "Termintreue",
  "persönliche Betreuung",
];

const PERSONA_FIRST_CONTACT_PHRASES = [
  "Formulierung 1",
  "Formulierung 2",
  "Formulierung 3",
  "Formulierung 4",
  "Formulierung 5",
  "Formulierung 6",
  "Formulierung 7",
];

const PERSONA_JOURNEY_STEPS = [
  "Schritt 1",
  "Schritt 2",
  "Schritt 3",
  "Schritt 4",
  "Schritt 5",
  "Schritt 6",
  "Schritt 7",
];

/** Fixed basis for Kunden-Persona (Wunschkunde) questionnaires — TEIL B. */
export const PERSONA_CORE_QUESTIONS: CoreQuestionTemplate[] = [
  {
    key: "persona_confirm_real_experience",
    stepId: "core_persona_intro",
    stepTitle: "Einleitung",
    stepDescription: "Nur Angaben auf Basis echter Erfahrungen und Beobachtungen.",
    title:
      "Bestätigung, dass alle folgenden Angaben auf Basis echter Erfahrungen und Beobachtungen erfolgen.",
    description:
      "Bitte mit Ja oder Nein antworten. Ohne diese Bestätigung ist der Fragebogen nicht auswertbar.",
    required: true,
    type: "radio",
    options: YES_NO,
  },

  {
    key: "persona_name",
    stepId: "core_persona_avatar",
    stepTitle: "Avatar-Definition & Profil",
    stepDescription: "Name, Kurzbeschreibung und Kundentypen.",
    title: "Wie soll der digitale Kunden-Avatar heißen (Vor- und Nachname)?",
    description: "Ein konkreter Name macht den Avatar greifbar.",
    required: true,
    type: "text",
    prefillHint: "persona_name",
  },
  {
    key: "persona_description",
    stepId: "core_persona_avatar",
    stepTitle: "Avatar-Definition & Profil",
    title: "Wie lässt sich die ideale Wunschkundschaft in drei bis fünf Sätzen beschreiben?",
    description: "",
    required: true,
    type: "text",
  },
  {
    key: "persona_customer_groups",
    stepId: "core_persona_avatar",
    stepTitle: "Avatar-Definition & Profil",
    title: "Welche unterschiedlichen Kundengruppen oder -typen kommen grundsätzlich vor?",
    description: "Optionen vor Versand pro Kunde/Branche ersetzen. „Sonstiges“ bleibt als Freitext.",
    required: false,
    type: "checkbox",
    options: opts("persona_group", PERSONA_CUSTOMER_GROUP_PLACEHOLDERS),
    allowOtherOption: true,
  },

  {
    key: "persona_age",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    stepDescription: "Alter, Beruf, Familie, Herkunft und Budget.",
    title: "In welchem Altersbereich befindet sich der Großteil der Wunschkundschaft?",
    description:
      "Einzelauswahl, weil meist eine Hauptgruppe klar dominiert. Bei „gemischt“ in der Bemerkung konkretisieren.",
    required: false,
    type: "radio",
    options: PERSONA_AGE_CLASSES,
    prefillHint: "persona_age",
  },
  {
    key: "persona_age_note",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    title: "Bemerkung zum Altersbereich (falls gemischt oder Abweichungen)",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_job",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    title:
      "Welcher berufliche Hintergrund oder welche Einkommenssituation trifft am häufigsten zu?",
    description: "Reihenfolge nach Häufigkeit. Die Basisliste ist branchenübergreifend.",
    required: false,
    type: "ranking",
    options: opts("persona_job", PERSONA_JOB_RANKING),
    allowExtraEntries: true,
    prefillHint: "persona_job",
  },
  {
    key: "persona_family",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    title: "Welche familiäre bzw. Lebenssituation beschreibt die Wunschkundschaft am häufigsten?",
    description: "",
    required: false,
    type: "checkbox",
    options: opts("persona_family", PERSONA_FAMILY),
    allowOtherOption: true,
  },
  {
    key: "persona_regions",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    title: "Aus welchen Regionen oder Orten stammt die Wunschkundschaft überwiegend?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_budget",
    stepId: "core_persona_demo",
    stepTitle: "Demografie & Lebenssituation",
    title: "In welchem Preis- oder Budgetbereich bewegen sich typische Aufträge oder Buchungen?",
    description:
      "Optionen vor Versand neu erstellen. Wochenumsatz und Projektvolumen sind nicht vergleichbar.",
    required: false,
    type: "ranking",
    options: opts("persona_budget", PERSONA_BUDGET_PLACEHOLDERS),
    allowExtraEntries: true,
  },

  {
    key: "persona_trigger",
    stepId: "core_persona_problems",
    stepTitle: "Auslöser, Ziele & Probleme",
    stepDescription: "Warum die Suche startet – und was wirklich zählt.",
    title: "Was ist der konkrete Auslöser, der zur Suche nach einer Lösung führt?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_goals",
    stepId: "core_persona_problems",
    stepTitle: "Auslöser, Ziele & Probleme",
    title: "Was sind die wichtigsten Ziele beim Start der Zusammenarbeit?",
    description: "Optionen vor Versand pro Branche neu erstellen. Reihenfolge nach Wichtigkeit.",
    required: false,
    type: "ranking",
    options: opts("persona_goal", PERSONA_GOAL_PLACEHOLDERS),
    allowExtraEntries: true,
  },
  {
    key: "persona_pain",
    stepId: "core_persona_problems",
    stepTitle: "Auslöser, Ziele & Probleme",
    title:
      "Wie wird die eigene Situation oder das eigene Problem im Erstgespräch beschrieben? Bitte wörtlich.",
    description: "Zitate, keine Umschreibung.",
    required: true,
    type: "text",
    prefillHint: "persona_pain",
  },
  {
    key: "persona_unspoken_drivers",
    stepId: "core_persona_problems",
    stepTitle: "Auslöser, Ziele & Probleme",
    title:
      "Welche tiefer liegenden Antreiber oder Ängste sind wirksam, auch wenn sie nicht offen ausgesprochen werden?",
    description: "Bitte wörtlich, soweit bekannt.",
    required: false,
    type: "text",
  },
  {
    key: "persona_past_frustrations",
    stepId: "core_persona_problems",
    stepTitle: "Auslöser, Ziele & Probleme",
    title:
      "Welche Frustrationen mit früheren Lösungen, Anbietern oder eigenen Versuchen werden erwähnt?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_first_contact_phrases",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    stepDescription: "Wörtliche Sprache, Recherche und Website-Lücken.",
    title:
      "Welche fünf bis sieben Formulierungen werden beim allerersten Kontakt am häufigsten verwendet?",
    description: "Bitte wörtlich. Ein Eintrag pro Formulierung.",
    required: false,
    type: "text_list",
    options: opts("persona_phrase", PERSONA_FIRST_CONTACT_PHRASES),
    allowExtraEntries: true,
  },
  {
    key: "persona_first_meeting_questions",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    title: "Was sind die drei häufigsten Fragen im Erstgespräch?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_jargon",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    title:
      "Welche Fachbegriffe werden selbst verwendet, und welche sind nicht bekannt oder werden verwechselt?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_research_activity",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    title: "Wie aktiv wird das Internet für die Recherche genutzt?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_RESEARCH_ACTIVITY,
  },
  {
    key: "persona_research_how",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    title: "Wie genau sieht diese Recherche aus?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_website_missing",
    stepId: "core_persona_language",
    stepTitle: "Sprache & Formulierungen",
    title: "Was wurde auf der Website vermisst oder nicht gefunden?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_time_to_order",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    stepDescription: "Dauer, Einfluss, Vergleich und Ausschlag.",
    title: "Wie lange dauert es typischerweise von der ersten Anfrage bis zur Auftragserteilung?",
    description: "Konkrete Zeitspanne, keine festen Raster.",
    required: false,
    type: "text",
  },
  {
    key: "persona_decision_influencers",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title:
      "Welche Personen oder Instanzen beeinflussen die Entscheidung (Kundschaft selbst, Partner/in, Familie, Freunde, Fachperson/Berater)?",
    description: "Reihenfolge nach Einflussstärke.",
    required: false,
    type: "ranking",
    options: opts("persona_influencer", PERSONA_DECISION_INFLUENCERS),
    allowExtraEntries: true,
  },
  {
    key: "persona_compare_quotes",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Werden üblicherweise mehrere Angebote eingeholt und verglichen?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_COMPARE_QUOTES,
  },
  {
    key: "persona_compare_quotes_note",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Ergänzung dazu, falls relevant",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_tipping_point",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Was gibt am Ende den Ausschlag für die Entscheidung?",
    description: "Bitte wörtlich, soweit bekannt.",
    required: false,
    type: "text",
  },
  {
    key: "persona_objections",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Welche Einwände oder Bedenken werden vor der Entscheidung am häufigsten geäußert?",
    description: "Optionen vor Versand pro Branche neu erstellen. Reihenfolge nach Häufigkeit.",
    required: false,
    type: "ranking",
    options: opts("persona_objection", PERSONA_OBJECTION_PLACEHOLDERS),
    allowExtraEntries: true,
  },
  {
    key: "persona_objections_verbatim",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Wörtliche Beispiele für diese Einwände",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_why_no",
    stepId: "core_persona_buying",
    stepTitle: "Kaufentscheidungsprozess",
    title: "Aus welchen Gründen haben sich manche Interessenten am Ende dagegen entschieden?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_delay_reaction",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    stepDescription: "Stilfragen mit fester, branchenunabhängiger Optionsliste.",
    title: "Wie wird auf Verzögerungen bei Terminen oder Zeitplänen reagiert?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_DELAY_REACTION,
  },
  {
    key: "persona_first_meeting_detail",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    title: "Wie detailliert läuft ein typisches Erstgespräch ab?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_FIRST_MEETING_DETAIL,
  },
  {
    key: "persona_personal_level",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    title: "Wie wichtig ist die persönliche Ebene für die Entscheidung?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_PERSONAL_LEVEL,
  },
  {
    key: "persona_decision_style",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    title:
      "Wie wird bei mehreren Auswahlmöglichkeiten entschieden – wird eher einer Empfehlung gefolgt, oder selbst entschieden?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_DECISION_STYLE,
  },
  {
    key: "persona_communication",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    title:
      "Wie läuft die Kommunikation während der Zusammenarbeit ab, und wie oft wird Kontakt gesucht?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_COMMUNICATION,
  },
  {
    key: "persona_problem_reaction",
    stepId: "core_persona_personality",
    stepTitle: "Persönlichkeit & Entscheidungsverhalten",
    title: "Wie wird auf unerwartete Probleme oder notwendige Änderungen reagiert?",
    description: "",
    required: false,
    type: "radio",
    options: PERSONA_PROBLEM_REACTION,
  },

  {
    key: "persona_info_sources",
    stepId: "core_persona_trust",
    stepTitle: "Informationsquellen & Vertrauensbildung",
    stepDescription: "Was im Gespräch positiv erwähnt wird – und woran Recherche erkennbar ist.",
    title:
      "Welche Informationsquellen werden im Gespräch positiv erwähnt (Empfehlung, Google-Bewertungen, Website, Social Media, Presse)?",
    description: "Reihenfolge nach Häufigkeit der Erwähnung.",
    required: false,
    type: "ranking",
    options: opts("persona_source", PERSONA_INFO_SOURCES),
    allowExtraEntries: true,
  },
  {
    key: "persona_reviews_mentioned",
    stepId: "core_persona_trust",
    stepTitle: "Informationsquellen & Vertrauensbildung",
    title: "Werden Google-Bewertungen oder andere Referenzen erwähnt, und was wird dazu gesagt?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_research_signs",
    stepId: "core_persona_trust",
    stepTitle: "Informationsquellen & Vertrauensbildung",
    title: "Woran erkennt man, dass bereits vorab recherchiert wurde?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_trust_signals",
    stepId: "core_persona_trust",
    stepTitle: "Informationsquellen & Vertrauensbildung",
    title:
      "Auf welche Qualifikationen oder Vertrauenssignale wird aktiv reagiert (Erfahrung/Jahre, Zertifikate, Bewertungen, Referenzen, persönlicher Eindruck)?",
    description: "Reihenfolge nach Wirkung.",
    required: false,
    type: "ranking",
    options: opts("persona_trust", PERSONA_TRUST_SIGNALS),
    allowExtraEntries: true,
  },

  {
    key: "persona_pre_contact_fears",
    stepId: "core_persona_hurdles",
    stepTitle: "Einwände, Ängste & Hürden",
    stepDescription: "Was vor dem ersten Kontakt bremst – und was die Hürde wegnimmt.",
    title: "Welche konkreten Sorgen oder Ängste werden vor dem ersten Kontakt geäußert?",
    description: "Bitte wörtlich, drei bis vier Beispiele.",
    required: false,
    type: "text",
  },
  {
    key: "persona_hold_back",
    stepId: "core_persona_hurdles",
    stepTitle: "Einwände, Ängste & Hürden",
    title: "Was hält vor dem ersten Kontakt typischerweise zurück?",
    description: "Mehrfachauswahl. Freitext über „Sonstiges“.",
    required: false,
    type: "checkbox",
    options: opts("persona_hold", PERSONA_HOLD_BACK),
    allowOtherOption: true,
  },
  {
    key: "persona_hurdle_remover",
    stepId: "core_persona_hurdles",
    stepTitle: "Einwände, Ängste & Hürden",
    title: "Was räumt diese Hürde erfahrungsgemäß weg?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_journey_steps",
    stepId: "core_persona_journey",
    stepTitle: "Kundenreise",
    stepDescription: "Schritte, Dauer, Abbruch und Alternativen.",
    title: "Wie sieht die typische Kundenreise in fünf bis sieben Schritten aus?",
    description: "Schritt für Schritt, ein Eintrag pro Phase.",
    required: false,
    type: "text_list",
    options: opts("persona_step", PERSONA_JOURNEY_STEPS),
    allowExtraEntries: true,
  },
  {
    key: "persona_journey_duration",
    stepId: "core_persona_journey",
    stepTitle: "Kundenreise",
    title: "Wie lange dauert jede Phase dieser Reise typischerweise?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_journey_dropoff",
    stepId: "core_persona_journey",
    stepTitle: "Kundenreise",
    title: "In welcher Phase springen die meisten Interessenten ab, und aus welchem Grund?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_alternatives",
    stepId: "core_persona_journey",
    stepTitle: "Kundenreise",
    title: "Welche Alternativen werden ernsthaft in Betracht gezogen?",
    description: "Optionen vor Versand pro Branche neu erstellen.",
    required: false,
    type: "ranking",
    options: opts("persona_alt", PERSONA_ALTERNATIVE_PLACEHOLDERS),
    allowExtraEntries: true,
  },
  {
    key: "persona_compared_with",
    stepId: "core_persona_journey",
    stepTitle: "Kundenreise",
    title: "Womit wird das Angebot konkret verglichen?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_return_behavior",
    stepId: "core_persona_aftercare",
    stepTitle: "Nachbetreuung & Weiterempfehlung",
    stepDescription: "Wiederkommen, Lob, Fan-Moment und Unzufriedenheit.",
    title:
      "Kommt die Kundschaft nach einem erfolgreichen Abschluss zurück, und wie verändert sich das Verhalten danach?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_praise",
    stepId: "core_persona_aftercare",
    stepTitle: "Nachbetreuung & Weiterempfehlung",
    title: "Was wird nach erfolgreichen Ergebnissen am häufigsten gelobt?",
    description: "Basisliste, vor Versand pro Kunde ergänzbar.",
    required: false,
    type: "ranking",
    options: opts("persona_praise", PERSONA_PRAISE),
    allowExtraEntries: true,
  },
  {
    key: "persona_fan_moment",
    stepId: "core_persona_aftercare",
    stepTitle: "Nachbetreuung & Weiterempfehlung",
    title: "Wann wird aus Kundschaft ein echter Fan? Was war der entscheidende Moment?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_referral_quote",
    stepId: "core_persona_aftercare",
    stepTitle: "Nachbetreuung & Weiterempfehlung",
    title: "Was wird wörtlich gesagt, wenn das Angebot weiterempfohlen wird?",
    description: "Bitte wörtlich.",
    required: false,
    type: "text",
  },
  {
    key: "persona_dissatisfaction",
    stepId: "core_persona_aftercare",
    stepTitle: "Nachbetreuung & Weiterempfehlung",
    title: "Falls bekannt: Was waren die Gründe für Unzufriedenheit?",
    description: "Bitte wörtlich.",
    required: false,
    type: "text",
  },

  {
    key: "persona_hormozi_dream",
    stepId: "core_persona_hormozi",
    stepTitle: "Hormozi-Layer",
    stepDescription: "Traumergebnis, Anstoß, Tempo und Dringlichkeit aus Kundensicht.",
    title:
      "Was wird als ideales Ergebnis beschrieben, wenn die Zusammenarbeit perfekt gelaufen ist?",
    description: "Bitte wörtlich.",
    required: false,
    type: "text",
  },
  {
    key: "persona_hormozi_trigger",
    stepId: "core_persona_hormozi",
    stepTitle: "Hormozi-Layer",
    title: "Was hat den Anstoß gegeben, überhaupt aktiv zu werden?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_hormozi_speed",
    stepId: "core_persona_hormozi",
    stepTitle: "Hormozi-Layer",
    title: "Wie schnell werden erste sichtbare Ergebnisse erwartet?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_hormozi_urgency",
    stepId: "core_persona_hormozi",
    stepTitle: "Hormozi-Layer",
    title: "Aus welchem Grund sollte jetzt eine Entscheidung getroffen werden und nicht erst später?",
    description: "",
    required: false,
    type: "text",
  },

  {
    key: "persona_anything_else",
    stepId: "core_persona_close",
    stepTitle: "Abschluss",
    stepDescription: "Was noch fehlt – und die dichte Kurzbeschreibung.",
    title: "Gibt es noch etwas Wichtiges über diese Zielgruppe, das bisher nicht abgefragt wurde?",
    description: "",
    required: false,
    type: "text",
  },
  {
    key: "persona_summary",
    stepId: "core_persona_close",
    stepTitle: "Abschluss",
    title:
      "Wie lässt sich die Wunschkundschaft in drei bis fünf Sätzen so beschreiben, dass sofort klar wird, wer gemeint ist?",
    description: "",
    required: false,
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
