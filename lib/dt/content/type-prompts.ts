/**
 * Writing recipes per page type („Textvorlagen“): what the SEO step (step 2) is told about
 * a Hauptsilo-Seite, Hauptseite, Unterseite, Ratgeberartikel, Standortseite, Startseite or
 * Über-uns-Seite.
 * The general rules for every type live in the Texter prompt (Globale Prompts). These recipes
 * only say what is different for that type. One set for the whole
 * agency, stored in `dt_content_type_prompts`; the defaults below are what „Auf Standard zurücksetzen“ restores.
 *
 * Pure: no Supabase, so client components and tests may use it. Loading and saving live in
 * `type-prompts-db.ts`. Only the SEO step reads a recipe; GEO, Hormozi and the other steps
 * keep their own fixed rules.
 */

import type { ContentPageType } from "@/lib/dt/content/page-types";

export const CONTENT_TYPE_PROMPT_KEYS = ["hauptsilo", "hauptseite", "unterseite", "ratgeber", "standort", "startseite", "ueber_uns"] as const;
export type ContentTypePromptKey = (typeof CONTENT_TYPE_PROMPT_KEYS)[number];
export type ContentTypePrompts = Record<ContentTypePromptKey, string>;

export const CONTENT_TYPE_PROMPT_MAX_CHARS = 20_000;

/** Written into a recipe where the name of the page's Hauptsilo belongs. */
export const CONTENT_TYPE_PROMPT_PILLAR_TOKEN = "[Hauptsilo]";

export const DEFAULT_CONTENT_TYPE_PROMPTS: ContentTypePrompts = {
  startseite: `Seitentyp Startseite. Die Startseite ist die Visitenkarte und der Verteiler. Ein Besucher muss in wenigen Sekunden verstehen: Was macht das Unternehmen, für wen, wo, warum gerade dieses, und was ist der nächste Schritt. Für KI-Systeme ist sie die wichtigste Quelle für die Entitätsbeschreibung des Unternehmens.

Pflicht-Inputs: Firmenname, Ort des Hauptsitzes, Einzugsgebiet; Hauptleistungen mit Zielseiten; Wunschkunde und dessen wichtigster Anlass; stärkste echte Beweise (Bewertungen, Zertifikate, Jahre am Markt, Garantien, Referenzen); primäres Conversion-Ziel und Telefonnummer. Fehlt etwas, Platzhalter.

Struktur:
1. H1: Hauptkategorie plus Hauptort, kurz. Kein Superlativ.
2. H2 (Hormozi-Subheadline): Traumergebnis des Wunschkunden in einem Satz.
3. Kurzzusammenfassung 60–80 Wörter, Hormozi-Reihenfolge. Satz 1: Kunde zuerst, kein Firmenname. Satz 2: Entitätssatz „{FIRMA} ist ein {Kategorie} aus {ORT}, spezialisiert auf {Kernleistung} für {Zielgruppe} in {Einzugsgebiet}.“ So formulieren, dass er auch auf der Über-uns-Seite stehen kann. Danach stärkster Beweis, wie schnell und mit wie wenig Aufwand der Kunde zum Ergebnis kommt, nächster Schritt.
4. Einleitung 100–150 Wörter: Situation des Kunden spiegeln, dann das Versprechen.
5. Vertrauensblock direkt nach der Einleitung. Echte Beweise kompakt.
6. Leistungsübersicht. Pro Leistung 2–4 Sätze aus Kundensicht (Problem, dann Ergebnis) und Link zur Zielseite. Keine Leistung vollständig erklären.
7. „So läuft die Zusammenarbeit ab“: 3–4 Schritte, Fokus auf wenig Aufwand für den Kunden.
8. Warum die Firma: 3–5 konkrete, überprüfbare Unterschiede. Keine austauschbaren Aussagen wie „kompetent und zuverlässig“.
9. Kundenstimmen, nur echte.
10. Einzugsgebiet. Orte nennen, auf vorhandene Standortseiten verlinken.
11. 3–5 Fragen im Fließtext, die vor der Kontaktaufnahme typisch sind.
12. Abschluss-CTA mit klarer nächster Handlung und Grund, jetzt zu handeln.

Besondere Regeln: Für Marke und Hauptkategorie optimieren, nicht für jede Einzelleistung. Name, Adresse und Telefon exakt so wie in den Fakten. Sprache für Erstbesucher. Jede Leistung mit eigener Seite wird von hier verlinkt. Die Über-uns-Seite aus dem Vertrauensblock oder dem Abschnitt „Warum die Firma“ verlinken.`,
  hauptsilo: `Seitentyp Hauptsilo-Seite. Sie bündelt ein Leistungsthema, zeigt den Überblick, hilft bei der Auswahl der Einzelleistung und verlinkt alle Unterseiten. Sie erklärt keine Einzelleistung in der Tiefe.

Pflicht-Inputs: Silo-Thema und Haupt-Keyword; Liste der Unterseiten; Zielgruppen innerhalb des Silos; echte Erfahrungswerte zu typischen Fällen, Kostenspannen und Dauer; Conversion-Ziel. Fehlt etwas, Platzhalter.

Struktur:
1. H1, Subheadline, Kurzzusammenfassung und Einleitung nach der allgemeinen Regel.
2. Für wen ist das Thema relevant? Typische Ausgangssituationen.
3. Entscheidungshilfe „Welche Leistung passt zu Ihnen?“: Situation, passende Leistung, Link.
4. Überblick der Leistungen. Pro Unterseite 60–120 Wörter: für wen, was enthalten, Link mit sprechendem Ankertext. Keine Volltiefe.
5. Ablauf allgemein für alle Leistungen des Silos.
6. Kosten und Einflussfaktoren. Preise nur, wenn sie in den Fakten stehen, sonst Platzhalter.
7. Typische Fehler oder Risiken bei der Anbieterwahl.
8. Beweise: Zertifikate, Erfahrung, echte Fälle oder klar als „typischer Fall“ gekennzeichnet.
9. Kundenstimmen.
10. Mindestens 5 Fragen im Fließtext: Kosten, Dauer, Vergleich, Voraussetzungen, Risiken.
11. Abschluss-CTA, der auch Unentschlossene abholt.

Besondere Regeln: Jede Unterseite des Silos wird verlinkt, Ankertext ist der Leistungsname. Zugehörige Ratgeber verlinken, nicht ausschreiben. Keine Links in fremde Silos außer zur Startseite, Kontakt und thematisch zwingend verwandten Seiten. Die Seite muss auch ohne Klick auf Unterseiten eine vollständige Orientierung geben. Fehlende Unterthemen nicht ausfüllen, sondern nur verlinken, wenn es die Seite schon gibt.`,
  hauptseite: `Seitentyp Hauptseite. Die Seite ist die zentrale Seite für genau ein Angebot, zu dem es keine Unterseiten gibt. Der Besucher bekommt hier das ganze Angebot auf einer Seite: welches Problem es löst, für wen es gedacht ist, was enthalten ist, wie es abläuft, was es kostet und was er als Nächstes tun kann. Sie ist keine Startseite und keine Silo-Übersicht.

Pflicht-Inputs: Angebot, Haupt- und Nebenkeywords; Zielgruppe und typischer Anlass; Leistungsumfang (was enthalten ist und was nicht); Ablauf aus Kundensicht; Preisinformationen, soweit in den Fakten; Beweise, Garantien und Zertifikate zu diesem Angebot; Conversion-Ziel und Kontaktweg; verwandte Seiten, die es bereits gibt. Fehlt etwas, Platzhalter.

Struktur:
1. H1, Subheadline, Kurzzusammenfassung und Einleitung nach der allgemeinen Regel. Die Subheadline nennt das Ergebnis dieses Angebots.
2. Für wen das Angebot gedacht ist und in welcher Situation. Konkrete Auslöser.
3. Was das Angebot löst: Ausgangslage des Kunden und Ergebnis.
4. Leistungsumfang vollständig. Was enthalten ist und was nicht. Alle Bestandteile hier erklären, nichts auf Unterseiten auslagern.
5. Ablauf Schritt für Schritt aus Kundensicht, mit Dauer nur wenn sie in den Fakten steht. Was der Kunde selbst tun muss.
6. Kosten. Einflussfaktoren plus Preisrahmen nur aus den Fakten. Direkt danach ein sekundärer CTA.
7. Die 2–4 häufigsten Einwände zu diesem Angebot, jeweils mit Beweis oder Garantie aus den Fakten.
8. Beweise: Praxisbeispiel (echt oder als „typischer Fall“ gekennzeichnet) und Kundenstimmen, nur echte.
9. Mindestens 5 Fragen zu diesem Angebot im Fließtext.
10. Abschluss-CTA mit konkreter nächster Handlung und minimalem Aufwand für den Kunden, nur so wie es die Fakten hergeben.

Besondere Regeln: Zur Startseite und zu verwandten Seiten verlinken, die es bereits gibt, nur über die erlaubten Linkziele (Marker [LINK: Seitenname]). Keine Unterseiten erfinden, keine Links auf Seiten, die es nicht gibt, kein Abschnitt, der auf erfundene Unterseiten verteilt. Kein Silo-Überblick und keine Zusammenfassung anderer Leistungen: ein anderes Angebot höchstens in einem Satz nennen und verlinken, wenn es seine Seite gibt. Grundlagenfragen an vorhandene Ratgeber verlinken statt ausschreiben. Tiefe zu diesem einen Angebot vor Breite.`,
  unterseite: `Seitentyp Unterseite innerhalb des Hauptsilos „[Hauptsilo]“. Die Seite verkauft genau eine Leistung. Der Besucher weiß bereits, was er braucht, und prüft: Können die das, wie läuft es ab, was kostet es, was muss ich tun? Das Silo wird nicht noch einmal aufgerollt.

Pflicht-Inputs: Leistung, Haupt- und Nebenkeywords; übergeordnete Silo-Seite und verwandte Unterseiten; Leistungsumfang (was enthalten ist und was nicht); Ablauf aus Kundensicht; Preisinformationen, soweit in den Fakten; Besonderheiten, Garantien, Zertifikate zu dieser Leistung; Conversion-Ziel. Fehlt etwas, Platzhalter.

Struktur:
1. H1, Subheadline, Kurzzusammenfassung und Einleitung nach der allgemeinen Regel. Die Subheadline nennt das Ergebnis dieser einen Leistung.
2. Wann der Kunde diese Leistung braucht. Konkrete Auslöser.
3. Leistungsumfang. Was enthalten ist und was nicht.
4. Ablauf Schritt für Schritt, mit Dauer nur wenn sie in den Fakten steht.
5. Kosten. Einflussfaktoren plus Preisrahmen nur aus den Fakten. Direkt danach ein sekundärer CTA.
6. Für wen geeignet und für wen nicht. Ehrlich abgrenzen und auf die passende Alternative verlinken.
7. Die 2–4 häufigsten Einwände zu genau dieser Leistung, jeweils mit Beweis oder Garantie aus den Fakten.
8. Praxisszenario, echt oder als „typischer Fall“ gekennzeichnet.
9. Kundenstimmen, wenn möglich zu genau dieser Leistung.
10. Mindestens 5 leistungsspezifische Fragen im Fließtext.
11. Abschluss-CTA mit konkreter nächster Handlung und minimalem Aufwand, nur so wie es die Fakten hergeben.

Besondere Regeln: Immer zurück zur Silo-Seite „[Hauptsilo]“ verlinken (Marker [LINK: [Hauptsilo]], Ankertext = Silo-Thema) und 2–3 Links zu verwandten Unterseiten. Grundlagenfragen an passende Ratgeber verlinken statt ausschreiben. Keine Inhalte aus anderen Unterseiten übernehmen. Detailtiefe vor Breite.`,
  ratgeber:
    "Seitentyp Ratgeberartikel: informationell. Aufbau Problem → Lösung → Vertrauen → nächster Schritt. Kein harter Verkauf, keine drängenden Handlungsaufforderungen (Schritt 5 nutzt den Ratgeber-Zyklus). Mindestens 5 Frage-Überschriften. Am Ende ein Abschnitt id „autor“ mit Autor- oder Prüfhinweis: nur mit einem Namen, der in den Anbieterfakten steht; sonst der Platzhalter [BITTE PRÜFEN: Autor oder fachliche Prüfung ergänzen]. Kein erfundener Autor.",
  standort: `Seitentyp Standortseite. Fokus ist die Leistung an diesem Ort, nicht die Leistung von Grund auf. Eine Seite, bei der man den Ortsnamen austauschen könnte, ist keine Standortseite. Verlinkt auf das Hauptsilo „[Hauptsilo]“ (Marker [LINK: [Hauptsilo]]), wenn eines angegeben ist.

Pflicht-Inputs: Leistung und Ort; echter Standort vor Ort oder Anfahrt vom Hauptsitz; Referenzen oder Stimmen aus diesem Ort, falls in den Fakten; Ansprechpartner vor Ort, falls vorhanden; verwandte Leistungs- und Silo-Seiten. Fehlt etwas, Platzhalter. Nichts dazuerfinden und keine Web-Recherche: nur Fakten aus den Anbieterfakten, den Anmerkungen und dem Briefing. Weniger als ein klarer lokaler Bezug und keine lokalen Referenzen: den Mangel als Platzhalter benennen, keine erfundene Lokalität.

Struktur:
1. H1: Leistung in dem Ort.
2. Subheadline: Traumergebnis mit lokalem Bezug.
3. Kurzzusammenfassung 60–80 Wörter. Satz 1 nennt das Wunschergebnis oder die typische Sorge eines Kunden an diesem Ort, ohne Firmennamen. Danach wer hilft, welche lokale Besonderheit aus den Fakten berücksichtigt wird, nächster Schritt.
4. Einleitung 100–150 Wörter: typische Situation eines Kunden an genau diesem Ort, nur aus den Fakten.
5. Was die Leistung an diesem Ort besonders macht. Nur Merkmale aus den Fakten, jeweils mit Folge für den Kunden.
6. Stadtteile und Umgebung nur, wenn sie in den Fakten stehen.
7. Ablauf vor Ort, inklusive Genehmigungen nur wenn sie belegt sind, und wer sie übernimmt.
8. Anfahrt und Erreichbarkeit. Echter Standort mit Adresse oder ehrlich die Anfahrt vom Hauptsitz, Dauer nur als Platzhalter wenn sie fehlt.
9. Referenzen und Kundenstimmen aus dem Ort. Nur echte. Fehlen sie, Platzhalter.
10. 3–5 ortsspezifische Fragen im Fließtext, Antworten nur mit belegten Fakten.
11. Abschluss-CTA mit lokalem Bezug.

Besondere Regeln: Keine Textbausteine, die für jeden Ort gleich wären. Bei echter Filiale Adresse, Telefon und Ansprechpartner exakt wie in den Fakten, plus [FOTO: echtes Projekt vor Ort] nur als Vorschlag. Keine gefälschte lokale Präsenz. Den Ortsnamen nicht stapeln: H1, Subheadline, Kurzzusammenfassung und dort, wo es inhaltlich natürlich ist. Verlinkung zur Silo-Seite „[Hauptsilo]“, zur Startseite und zur Kontaktseite.`,
  ueber_uns: `Seitentyp Über-uns-Seite. Sie beantwortet die Vertrauensfrage: wer hinter dem Unternehmen steht, mit welcher Erfahrung. Für KI-Systeme ist sie die Hauptquelle für Fakten zur Firma. Der Kunde bleibt der Held, das Unternehmen ist der erfahrene Begleiter. Sie verkauft keine Leistungen.

Pflicht-Inputs: Firmenname, Rechtsform, Gründungsjahr, Hauptsitz; Inhaber oder Geschäftsführung mit Name, Qualifikation und Rolle; Team nur mit belegten Personen; Gründungsanlass; Spezialisierung und Einzugsgebiet; Zertifikate und Mitgliedschaften mit Aussteller; Arbeitsweise, belegt durch konkrete Handlungen. Fehlt etwas, Platzhalter. Nichts ausschmücken.

Struktur:
1. H1: „Über {FIRMA}“ oder „{FIRMA}: {Kategorie} aus {ORT}“.
2. Subheadline: das Versprechen an den Kunden, nicht an das Unternehmen gerichtet.
3. Kurzzusammenfassung 60–80 Wörter. Satz 1 greift die Vertrauensfrage auf. Satz 2 ist derselbe Entitätssatz wie auf der Startseite, aus den Fakten. Danach Gründungsjahr, Inhaber, Sitz, Spezialisierung und Einzugsgebiet, soweit belegt.
4. Einleitung 100–150 Wörter: warum es das Unternehmen gibt, verbunden mit dem Problem des Kunden.
5. Geschichte. Nur gelieferte Fakten, keine ausgeschmückten Anekdoten.
6. Die Menschen. Inhaber mit Name, Qualifikation, Erfahrung, Zuständigkeit. [FOTO: …] als Vorschlag. Zitate nur, wenn sie wörtlich in den Fakten stehen.
7. Wie wir arbeiten. 3–5 Prinzipien, jedes mit konkretem Beleg.
8. Qualifikationen und Nachweise mit Aussteller und Jahr, nur echte.
9. Für wen wir arbeiten. Zielgruppen und Einzugsgebiet, mit Links zu Silo- und Standortseiten.
10. „Auf einen Blick“: Firmenname, Rechtsform, Gründung, Inhaber, Adresse, Telefon, Leistungen, Einzugsgebiet, Zertifikate, Bewertungsschnitt. Nur echte Angaben, sonst weglassen oder Platzhalter.
11. Abschluss-CTA: persönlicher Kontakt, mit Name des Ansprechpartners wenn er in den Fakten steht.

Besondere Regeln: Fakten müssen zu den übrigen Anbieterfakten passen. Keine Floskeln wie „Leidenschaft“ oder „Herzblut“ ohne konkreten Beleg. Wir-Form ist hier erlaubt, der Kundennutzen bleibt in jedem Abschnitt sichtbar. Kein Leistungskatalog: Leistungen nur nennen und verlinken. 2–4 Vertrauensfragen im Fließtext (seit wann, wer ist Ansprechpartner, ist das Unternehmen seriös), nur mit belegten Fakten. Bei YMYL-Branchen Qualifikationen und Zulassungen vollständig, sonst Platzhalter.`,
};

export const CONTENT_TYPE_PROMPT_LABELS: Record<ContentTypePromptKey, string> = {
  hauptsilo: "Hauptsilo-Seite",
  hauptseite: "Hauptseite",
  unterseite: "Unterseite",
  ratgeber: "Ratgeberartikel",
  standort: "Standortseite",
  startseite: "Startseite",
  ueber_uns: "Über-uns-Seite",
};

/** One line under each textarea of the „Textvorlagen“ card. */
export const CONTENT_TYPE_PROMPT_HELP: Record<ContentTypePromptKey, string> = {
  hauptsilo: "Übersicht zum großen Thema, Unterthemen nur anreißen und verlinken.",
  hauptseite: "Eine Leistung als eigene Hauptseite, ohne Unterseiten.",
  unterseite: "Ein Unterthema in der Tiefe, immer zurück zum Hauptsilo verlinken.",
  ratgeber: "Hilfe-Artikel, Fragen beantworten, nicht hart verkaufen.",
  standort: "Leistung an einem Ort.",
  startseite: "Die Startseite der Website.",
  ueber_uns: "Die Seite über das Unternehmen.",
};

export function isContentTypePromptKey(value: unknown): value is ContentTypePromptKey {
  return typeof value === "string" && (CONTENT_TYPE_PROMPT_KEYS as readonly string[]).includes(value);
}

/** Trimmed and capped; an empty recipe is never stored, the default takes its place. */
export function cleanContentTypePrompt(key: ContentTypePromptKey, value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, CONTENT_TYPE_PROMPT_MAX_CHARS) : "";
  return text || DEFAULT_CONTENT_TYPE_PROMPTS[key];
}

/** Any object (a DB row, a request body) → a complete set; missing or empty entries fall back to the default. */
export function normalizeContentTypePrompts(input: unknown): ContentTypePrompts {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(
    CONTENT_TYPE_PROMPT_KEYS.map((key) => [key, cleanContentTypePrompt(key, record[key])]),
  ) as ContentTypePrompts;
}

export function isDefaultContentTypePrompt(key: ContentTypePromptKey, value: string): boolean {
  return cleanContentTypePrompt(key, value) === DEFAULT_CONTENT_TYPE_PROMPTS[key];
}

export function hasCustomContentTypePrompts(prompts: ContentTypePrompts): boolean {
  return CONTENT_TYPE_PROMPT_KEYS.some((key) => !isDefaultContentTypePrompt(key, prompts[key]));
}

/** Which recipe a page type uses; a page that gets no text of its own would write like an Unterseite. */
export function contentTypePromptKeyFor(pageType: ContentPageType): ContentTypePromptKey {
  return pageType === "nicht_bearbeiten" ? "unterseite" : pageType;
}

/**
 * The recipe as the SEO step reads it: `[Hauptsilo]` becomes the name of the page's
 * Hauptsilo. Without one the word „Hauptsilo“ stays, as the fixed rule used to say.
 */
export function renderContentTypePrompt(
  prompts: ContentTypePrompts,
  pageType: ContentPageType,
  pillarName: string | null | undefined,
): string {
  const key = contentTypePromptKeyFor(pageType);
  const recipe = cleanContentTypePrompt(key, prompts[key]);
  return recipe.split(CONTENT_TYPE_PROMPT_PILLAR_TOKEN).join(pillarName?.trim() || "Hauptsilo");
}
