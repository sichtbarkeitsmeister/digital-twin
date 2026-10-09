/**
 * Writing recipes per page type („Textvorlagen“): what the SEO step (step 2) is told about
 * a Hauptsilo-Seite, Unterseite, Ratgeberartikel or Standortseite. One set for the whole
 * agency, stored in `dt_content_type_prompts`; the defaults below are the rules the step
 * used before they became editable and are what „Auf Standard zurücksetzen“ restores.
 *
 * Pure: no Supabase, so client components and tests may use it. Loading and saving live in
 * `type-prompts-db.ts`. Only the SEO step reads a recipe; GEO, Hormozi and the other steps
 * keep their own fixed rules.
 */

import type { ContentPageType } from "@/lib/dt/content/page-types";

export const CONTENT_TYPE_PROMPT_KEYS = ["hauptsilo", "unterseite", "ratgeber", "standort"] as const;
export type ContentTypePromptKey = (typeof CONTENT_TYPE_PROMPT_KEYS)[number];
export type ContentTypePrompts = Record<ContentTypePromptKey, string>;

export const CONTENT_TYPE_PROMPT_MAX_CHARS = 8_000;

/** Written into a recipe where the name of the page's Hauptsilo belongs. */
export const CONTENT_TYPE_PROMPT_PILLAR_TOKEN = "[Hauptsilo]";

export const DEFAULT_CONTENT_TYPE_PROMPTS: ContentTypePrompts = {
  hauptsilo:
    "Seitentyp Hauptsilo-Seite: Die Seite deckt das Thema in der Breite ab. Unterthemen, die eine eigene Unterseite haben, werden nur angerissen und verlinkt (2–5 interne Links, nur auf erlaubte Linkziele), nicht ausführlich behandelt. Suchintention meist transaktional oder kommerziell-vergleichend: die Seite führt zur Anfrage. Mindestens 3 Frage-Überschriften.",
  unterseite:
    "Seitentyp Unterseite innerhalb eines Hauptsilos: Die Seite geht bei EINEM Unterthema in die Tiefe und verlinkt IMMER auf ihr Hauptsilo „[Hauptsilo]“ (Marker [LINK: [Hauptsilo]]). Das ganze Silo wird nicht noch einmal aufgerollt: gleiches Gerüst, engerer Fokus. Mindestens 3 Frage-Überschriften.",
  ratgeber:
    "Seitentyp Ratgeberartikel: informationell. Aufbau Problem → Lösung → Vertrauen → nächster Schritt. Kein harter Verkauf, keine drängenden Handlungsaufforderungen (Schritt 5 nutzt den Ratgeber-Zyklus). Mindestens 5 Frage-Überschriften. Am Ende ein Abschnitt id „autor“ mit Autor- oder Prüfhinweis: nur mit einem Namen, der in den Anbieterfakten steht; sonst der Platzhalter [BITTE PRÜFEN: Autor oder fachliche Prüfung ergänzen]. Kein erfundener Autor.",
  standort:
    "Seitentyp Standortseite: wie eine Unterseite, Fokus ist die Leistung an diesem Ort. Verlinkt auf das Hauptsilo „[Hauptsilo]“ ([LINK: [Hauptsilo]]), wenn eines angegeben ist. Lokaler Bezug nur aus den Anbieterfakten (Einzugsgebiet, Anfahrt, Besonderheiten, Ansprechpartner); keine erfundenen Ortsangaben, den Ortsnamen nicht stapeln. Mindestens 3 Frage-Überschriften.",
};

export const CONTENT_TYPE_PROMPT_LABELS: Record<ContentTypePromptKey, string> = {
  hauptsilo: "Hauptsilo-Seite",
  unterseite: "Unterseite",
  ratgeber: "Ratgeberartikel",
  standort: "Standortseite",
};

/** One line under each textarea of the „Textvorlagen“ card. */
export const CONTENT_TYPE_PROMPT_HELP: Record<ContentTypePromptKey, string> = {
  hauptsilo: "Übersicht zum großen Thema, Unterthemen nur anreißen und verlinken.",
  unterseite: "Ein Unterthema in der Tiefe, immer zurück zum Hauptsilo verlinken.",
  ratgeber: "Hilfe-Artikel, Fragen beantworten, nicht hart verkaufen.",
  standort: "Leistung an einem Ort.",
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
