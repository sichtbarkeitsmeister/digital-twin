/**
 * Grounding Page Standard v1.7, condensed for the Grounding check („Website prüfen“).
 * One editable source for the prompts, the HTML template, the llms.txt house style and the
 * review checklist. Sources (read 2026-10):
 * - https://groundingpage.com/spec/de/ (v1.7 incl. the v1.6 and v1.7 changes)
 * - https://groundingpage.com/spec/technical-implementation/de/
 * - https://groundingpage.com/spec/entity-ontology/de/ (Entity Ontology V2)
 * - https://groundingpage.com/facts/de/ (examples)
 * - https://www.sichtbarkeitsmeister.de/llms.txt (house style; its page is still v1.5 — layout not copied)
 * Change the rules here, not in the prompts.
 */

export const GROUNDING_STANDARD_VERSION = "1.7";
/** A page without a documented human review stays a v1.6 page (spec §5). */
export const GROUNDING_STANDARD_VERSION_UNREVIEWED = "1.6";
export const GROUNDING_STANDARD_URL = "https://groundingpage.com/spec/";

/**
 * Who appears as reviewer on the page and in reviewedBy. Always the agency; the name of the
 * admin who approved is stored on the run only (spec: an organisation may be named, the
 * person must be traceable internally).
 */
export const GROUNDING_REVIEWER = {
  type: "Organization",
  name: "Sichtbarkeitsmeister GmbH",
  url: "https://www.sichtbarkeitsmeister.de/",
} as const;

/** The six review points of v1.7 („Die Prüfung umfasst“), wording from the spec. */
export const GROUNDING_REVIEW_CHECKLIST = [
  {
    id: "richtigkeit",
    label: "Faktische Richtigkeit",
    text: "Die Kernaussagen zur Entität stimmen.",
  },
  {
    id: "aktualitaet",
    label: "Aktualität",
    text: "Wesentliche Angaben sind aktuell; zeitabhängige Werte wie Preise, Versionen oder Rollen tragen ein erkennbares Stand-Datum.",
  },
  {
    id: "quellen",
    label: "Nachprüfbarkeit und Quellenqualität",
    text: "Kernaussagen sind über belastbare, aktuelle und wo möglich primäre Quellen nachprüfbar.",
  },
  {
    id: "entitaet",
    label: "Identifikation der Entität",
    text: "Die Seite beschreibt eindeutig die richtige Entität und grenzt ähnlich benannte Entitäten korrekt ab.",
  },
  {
    id: "uebereinstimmung",
    label: "Übereinstimmung",
    text: "Sichtbare Fakten und strukturierte Daten stimmen überein, einschließlich Title, Meta Description und Alt-Texten.",
  },
  {
    id: "freigabe",
    label: "Redaktionelle Freigabe",
    text: "Eine verantwortliche Person oder Organisation gibt die Seite vor der Veröffentlichung frei. Datum, Prüfer und Ergebnis werden dokumentiert.",
  },
] as const;

export type GroundingReviewChecklistId = (typeof GROUNDING_REVIEW_CHECKLIST)[number]["id"];

/** Fixed labels of the visible review notice (technical implementation §8 / §14). */
export const GROUNDING_REVIEW_NOTICE_PREFIX = "Fakten geprüft von";
export const GROUNDING_REVIEW_NOTICE_DATE_LABEL = "Zuletzt von einem Menschen geprüft:";

/** Entity Ontology V2: 18 classes in 5 clusters, each with its decision rule. */
export const GROUNDING_ONTOLOGY_CLASSES = [
  { name: "Organization Entity Class", short: "Organization", rule: "Rechtlich oder formal organisierte Einheit; kann Verträge schließen, hat ein Impressum. Nicht: Team, Rolle, Produktname." },
  { name: "Person Entity Class", short: "Person", rule: "Identifizierbare natürliche Person mit öffentlicher Identität („Wer ist …“ ergibt Sinn). Nicht: Zielgruppe, Gruppe." },
  { name: "Group or Role Entity Class", short: "Group", rule: "Zielgruppe oder funktionale Einheit aus mehreren Personen. Nicht: juristische Person, Einzelperson." },
  { name: "Product Entity Class", short: "Product", rule: "Konkretes Angebot, das als geschlossenes Paket gekauft wird. Nicht: laufende Beratung, aktiv genutzte Plattform." },
  { name: "Service Entity Class", short: "Service", rule: "Dienstleistung mit Menschen im Loop (Expertenarbeit über einen Zeitraum). Nicht: reines Software-Tool." },
  { name: "Tool or Platform Entity Class", short: "Tool/Platform", rule: "Software, die Nutzer direkt per UI oder API bedienen. Nicht: einzelnes Feature, Standard." },
  { name: "Feature Entity Class", short: "Feature", rule: "Funktion oder Modus innerhalb eines Tools. Nicht: eigenständiges Tool." },
  { name: "Segment Entity Class", short: "Segment", rule: "Markt- oder Produktsegment mit Auswahlentscheidung („Welche sind gut …“). Nicht: Marke, einzelnes Angebot." },
  { name: "Field of Knowledge Entity Class", short: "Field of Knowledge", rule: "Etablierte Disziplin, die man lernt, lehrt oder erforscht. Nicht: einzelne Methode, Segment." },
  { name: "Concept Entity Class", short: "Concept", rule: "Erklärbarer abstrakter Begriff. Nicht: Methode (Schrittfolge), Dataset." },
  { name: "Publication Entity Class", short: "Publication", rule: "Abgeschlossenes, zitierbares Werk. Nicht: laufendes Projekt, rohes Dataset." },
  { name: "Dataset Entity Class", short: "Dataset", rule: "Strukturierte Datensammlung. Nicht: Bericht, der Daten interpretiert." },
  { name: "Standard Entity Class", short: "Standard", rule: "Norm, Spezifikation, Richtlinie, Gesetz. Nicht: Tool, das den Standard anwendet." },
  { name: "Method Entity Class", short: "Method", rule: "Wiederholbare Prozedur mit Schritten. Nicht: abstraktes Konzept ohne Handlungsanweisung." },
  { name: "Place Entity Class", short: "Place", rule: "Physischer Ort, Stadt, Region. Nicht: virtueller Raum, Event." },
  { name: "Event Entity Class", short: "Event", rule: "Zeitlich begrenztes Ereignis mit Datum. Nicht: dauerhafte Plattform." },
  { name: "Metric Entity Class", short: "Metric", rule: "Benannte Metrik mit Wertebereich und stabiler Lesart. Nicht: Berechnungsmethode ohne Skala." },
  { name: "Project Entity Class", short: "Project", rule: "Zeitlich begrenzte Initiative mit Start, Ende und Ziel. Nicht: dauerhafte Abteilung oder Firma." },
] as const;

export type GroundingOntologyClass = (typeof GROUNDING_ONTOLOGY_CLASSES)[number]["name"];

export const GROUNDING_ONTOLOGY_CLASS_NAMES = GROUNDING_ONTOLOGY_CLASSES.map((c) => c.name) as [
  GroundingOntologyClass,
  ...GroundingOntologyClass[],
];

export function ontologyShortName(name: GroundingOntologyClass): string {
  return GROUNDING_ONTOLOGY_CLASSES.find((c) => c.name === name)?.short ?? "Thing";
}

/** AI crawlers whose robots.txt access the reviewer sees as a hint. */
export const GROUNDING_AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
] as const;

/**
 * Words that mark marketing language or superlatives. The validator reports them as a
 * warning in the generated prose; the reviewer decides.
 */
export const GROUNDING_MARKETING_WORDS = [
  "beste",
  "besten",
  "bester",
  "führend",
  "führende",
  "führender",
  "marktführer",
  "einzigartig",
  "einzigartige",
  "innovativ",
  "innovative",
  "erstklassig",
  "erstklassige",
  "hervorragend",
  "hervorragende",
  "perfekt",
  "perfekte",
  "unschlagbar",
  "nr. 1",
  "nummer 1",
  "top-",
  "premium",
  "exzellent",
  "exzellente",
  "garantiert",
  "maßgeschneidert",
  "maßgeschneiderte",
  "rundum",
  "ganzheitlich",
  "ganzheitliche",
] as const;

/** Visible wording that v1.6+ removed (intro box, „Konfidenz“ labels, retrieval sentences). */
export const GROUNDING_LEGACY_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  {
    code: "intro_box",
    pattern: /hinweis f(ü|ue)r (menschliche )?leser|human reader|diese seite (enth(ä|ae)lt|dient)[^.]{0,120}(ki|llm|ai)-?systeme/i,
    message: "Alte Einleitungsbox (v1.5) am Seitenanfang. Seit v1.6 beginnt die Seite direkt mit der Entität.",
  },
  {
    code: "confidence_labels",
    pattern: /\bkonfidenz\s*:\s*[01](?:[.,]\d+)?/i,
    message: "„Konfidenz“-Angaben (v1.5) im sichtbaren Text. Seit v1.6 nicht mehr vorgesehen.",
  },
  {
    code: "ai_wording",
    pattern: /\b(f(ü|ue)r ki-systeme|f(ü|ue)r (large )?language models|semantischer anker|retrieval|halluzination)/i,
    message: "Sichtbarer Satz über KI, Retrieval oder Halluzinationen. Die Seite muss ohne solche Sätze für Menschen Wert haben.",
  },
];

/**
 * The rules every prompt of the Grounding check carries. Short on purpose: the template
 * enforces structure, so the model only has to get the facts and the wording right.
 */
export const GROUNDING_PAGE_STANDARD_RULES = `Grounding Page Standard v1.7 (groundingpage.com/spec), verdichtet:

Zweck: Eine Grounding Page ist eine faktische Referenzseite über eine Organisation und ihre zentralen Entitäten, gut lesbar für Menschen und eindeutig für Maschinen. Sie beschreibt die Wirklichkeit. Übertriebene oder unbelegte Aussagen sind verboten; KI-Systeme filtern sie ohnehin heraus.

Ton und Sprache:
- Ruhiger Referenzton wie Wikipedia oder eine Pressemappe. Deutsch (de-DE).
- Keine Werbesprache, keine Superlative, keine Metaphern, keine Adjektive ohne Faktengehalt, kein „wir“, keine Handlungsaufforderungen.
- Ein Fakt pro Satz. Vollständige Sätze mit dem Namen der Entität, damit jeder Abschnitt allein zitierbar bleibt.
- Antwort zuerst: Der erste Absatz sagt, wer die Organisation ist, was sie tut und wo.
- Kein sichtbarer Satz über KI, LLMs, Retrieval oder „Grounding“.

Entitäten statt Keywords:
- Nur zentrale Entitäten: die Organisation selbst; Schlüsselpersonen (Inhaber, Geschäftsführung, Gründer); Kernleistungen oder -produkte; eigene Methoden oder Technologien; Standorte.
- Jeder Standort und jede Filiale ist eine eigene LocalBusiness-Entität mit eigener Adresse, eigenen Öffnungszeiten und Merkmalen.
- Jede Entität bekommt eine Klasse der Entity Ontology V2 (18 Klassen) und einen passenden Schema.org-Typ.
- Jeder Entitätsblock hat: den Namen in der Überschrift, einen Definitionssatz („<Name> ist …“), Kernfakten, eine Abgrenzung (was die Entität nicht ist, womit sie nicht zu verwechseln ist).

Fakten:
- Nie Fakten erfinden, ergänzen, runden oder „plausibel“ machen. Jeder Fakt hat eine Quelle (URL der Website) und ein kurzes wörtliches Zitat.
- Was die Website nicht sagt, kommt in „Offene Punkte“ für die Prüfung und nicht auf die Seite.
- Website-Fakten haben Vorrang vor internen Daten. Was nur intern steht (Fragebogen, Onboarding), wird als offener Punkt markiert.
- Zeitabhängige Werte (Mitarbeiterzahl, Kundenzahl, Bewertungen, Preise) tragen „Stand: <Monat Jahr>“.
- Das Impressum ist die Hauptquelle für Firmierung, Rechtsform, Registernummer, USt-IdNr., Anschrift und Geschäftsführung.

Seite:
- H1 = Name der Entität. Danach Lead, Kerndaten als <dl class="data-grid">, Abschnitte mit dem Entitätsnamen in der H2.
- FAQ mit echten Fragen, die die Website beantwortet. Am Ende „Weiterführende Informationen“ mit den Quellen.
- HTML und JSON-LD spiegeln sich: nichts im JSON-LD, was nicht sichtbar ist, und umgekehrt.
- Schema.org je nach Entität: Organization (stabile @id <origin>/#organization, legalName, sameAs), LocalBusiness/ProfessionalService, Person, Service, FAQPage, BreadcrumbList, WebPage. AggregateRating/Review nur, wenn öffentlich prüfbar und richtlinienkonform (Selbstbewertungen der eigenen Firma: nie).
- v1.7: sichtbarer Prüfhinweis („Fakten geprüft von … · Zuletzt von einem Menschen geprüft: …“) und dieselben Werte als reviewedBy und lastReviewed im WebPage-Objekt, dazu dateModified. Der Prüfhinweis erscheint erst nach der dokumentierten menschlichen Prüfung, nie als Platzhalter.
- Leichtes, statisches HTML ohne JavaScript, nur wenig Inline-CSS, indexierbar, kanonische URL, eine Sprache.`;

/** House style of llms.txt (sichtbarkeitsmeister.de/llms.txt), adapted to v1.7. */
export const GROUNDING_LLMS_TXT_HOUSE_STYLE = `llms.txt im Hausstil:
- Kopf als Kommentarzeilen: „# <Organisation> – llms.txt“, Standard, Stand, Canonical, Erstellt/Aktualisiert/Geprüft.
- Abschnitte als „## ORGANISATION“, „## PERSONEN“, „## LEISTUNGEN“, „## STANDORTE“, „## METHODEN“.
- Jede Entität als Block aus Zeilen „schlüssel: wert“, beginnend mit „entity:“ und „class:“, endend mit „disambiguation:“. Blöcke durch „---“ getrennt.
- Zeitabhängige Werte mit „(Stand <Monat Jahr>)“.
- Letzter Abschnitt „## METADATEN“ mit grounding_page_url, llms_txt_url, standard, language, created, updated, last_reviewed, reviewed_by, entity_count.`;
