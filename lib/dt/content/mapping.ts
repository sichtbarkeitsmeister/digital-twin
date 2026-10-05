/**
 * DigitalTwin data → Content-Agent payloads (`PUT /api/v1/clients/{org}`).
 * Pure functions: no Supabase, no fetch, no Node APIs, so client components may use them too.
 * Loading happens in `load-sources.ts`.
 *
 * Client facts are the free-text workshop sections in `dt_workshop_corpus.anbieter`
 * (`ANBIETER_POINTS`). The four strict fields (anrede, branche, tonalitaet, verbotene_woerter)
 * cannot be read reliably from prose: `suggestTextSettings` only pre-fills the
 * "Einstellungen für Texte" card, and a person confirms the values.
 */

import type { AnbieterItem } from "@/lib/dt/transcripts/workshop-model";

export const CONTENT_ANREDEN = ["Sie", "Du"] as const;
export type ContentAnrede = (typeof CONTENT_ANREDEN)[number];

export const CONTENT_BRANCHEN = ["handwerk", "rechtsanwalt", "arzt"] as const;
export type ContentBranche = (typeof CONTENT_BRANCHEN)[number];

export const CONTENT_BRANCHE_LABELS: Record<ContentBranche, string> = {
  handwerk: "Handwerk & Dienstleistung",
  rechtsanwalt: "Rechtsanwalt & Kanzlei",
  arzt: "Arzt & Praxis",
};

export type ContentTextSettings = {
  anrede: ContentAnrede;
  branche: ContentBranche;
  tonalitaet: string;
  verbotene_woerter: string[];
};

export type ContentTextSettingsSuggestion = {
  settings: ContentTextSettings;
  /** Why a value was suggested, e.g. `„Kanzlei“ in „Unternehmen & Kern“`. Missing = default. */
  reasons: Partial<Record<keyof ContentTextSettings, string>>;
};

/** One workshop section. `key` is one of `ANBIETER_POINTS`, `current` the latest free text. */
export type WorkshopAnbieterSection = Pick<AnbieterItem, "label" | "current"> & { key: string };

/** `name` plus one free-text entry per filled workshop section. */
export type ContentAnbieter = { name: string } & Record<string, string>;

export type ContentAnbieterPayload = ContentTextSettings & {
  name: string;
  [section: string]: unknown;
};

export type ContentAvatar = {
  name: string;
  role: string;
  beschreibung: string;
  [key: string]: unknown;
};

export type DtAgentForContent = {
  name: string;
  role?: string | null;
  prompt_template?: string | null;
  avatar_data?: unknown;
};

const STRICT_KEYS = new Set<string>(["name", "anrede", "branche", "tonalitaet", "verbotene_woerter"]);
const SECTION_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const TONALITAET_MAX = 1_000;
const WORD_MAX = 80;
const WORDS_MAX = 50;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function sectionOf(items: readonly WorkshopAnbieterSection[], key: string) {
  const item = items.find((i) => i.key === key);
  const text = item?.current?.trim() ?? "";
  return { text, label: item?.label?.trim() || key };
}

/** Number of workshop sections that have text. */
export function filledWorkshopSections(items: readonly WorkshopAnbieterSection[]): number {
  return items.filter((i) => i.current?.trim()).length;
}

/**
 * Workshop sections → Content-Agent `anbieter` object: every filled section under its key as free
 * text, plus `name`. Empty sections are left out so the service never reads them as facts.
 */
export function anbieterFromWorkshop(
  items: readonly WorkshopAnbieterSection[],
  options: { organisationName: string },
): ContentAnbieter {
  const anbieter: ContentAnbieter = { name: options.organisationName.trim() };
  for (const item of items) {
    const key = item.key?.trim() ?? "";
    const text = item.current?.trim() ?? "";
    if (!text || !SECTION_KEY.test(key) || STRICT_KEYS.has(key)) continue;
    anbieter[key] = anbieter[key] ? `${anbieter[key]}\n\n${text}` : text;
  }
  return anbieter;
}

/** The merged object sent as `anbieter`: workshop free text plus the confirmed strict fields. */
export function mergeContentAnbieter(
  anbieter: ContentAnbieter,
  settings: ContentTextSettings,
): ContentAnbieterPayload {
  const clean = cleanTextSettings(settings);
  return {
    ...anbieter,
    anrede: clean.anrede,
    branche: clean.branche,
    tonalitaet: clean.tonalitaet,
    verbotene_woerter: clean.verbotene_woerter,
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function cleanWord(value: string): string {
  return value
    .trim()
    .replace(/^[-•*\s„“"»«‚‘’']+|[\s„“"»«‚‘’'.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, WORD_MAX)
    .trim();
}

/** Free input ("Schrott, billig\nRamsch") → word list. Commas, semicolons and line breaks separate. */
export function parseWordList(text: string): string[] {
  return dedupe(text.split(/[,;\n]+/).map(cleanWord).filter(Boolean)).slice(0, WORDS_MAX);
}

export function cleanTextSettings(settings: ContentTextSettings): ContentTextSettings {
  return {
    anrede: settings.anrede === "Du" ? "Du" : "Sie",
    branche: (CONTENT_BRANCHEN as readonly string[]).includes(settings.branche)
      ? settings.branche
      : "handwerk",
    tonalitaet: settings.tonalitaet.trim().replace(/\s+/g, " ").slice(0, TONALITAET_MAX),
    verbotene_woerter: dedupe(settings.verbotene_woerter.map(cleanWord).filter(Boolean)).slice(
      0,
      WORDS_MAX,
    ),
  };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean);
}

const DU_EXPLICIT = /\bdu(?:zen|zt)\b|\bgeduzt\b|\bper du\b|\bdu-form\b/i;
const SIE_EXPLICIT = /\bsie(?:zen|zt)\b|\bgesiezt\b|\bper sie\b|\bsie-form\b/i;

function suggestAnrede(text: string): { value: ContentAnrede; match: string | null } {
  const du = text.match(DU_EXPLICIT);
  const sie = text.match(SIE_EXPLICIT);
  if (du && !sie) return { value: "Du", match: du[0] };
  if (sie && !du) return { value: "Sie", match: sie[0] };
  if (du && sie) return { value: "Sie", match: null };
  const loose = text.match(/\bdu\b/i);
  if (loose) return { value: "Du", match: loose[0] };
  return { value: "Sie", match: null };
}

const LAW = /anw[aä]lt\w*|kanzlei\w*|jurist\w*|\bnotar(?!zt)\w*/i;
const MEDICAL = /\w*[aä]rzt\w*|\bpraxis\b|\bpatient\w*|\bklinik\w*|zahnmedizin\w*/i;

function suggestBranche(text: string): { value: ContentBranche; match: string | null } {
  const law = text.match(LAW);
  if (law) return { value: "rechtsanwalt", match: law[0] };
  const medical = text.replace(/\bin der praxis\b/gi, " ").match(MEDICAL);
  if (medical) return { value: "arzt", match: medical[0] };
  return { value: "handwerk", match: null };
}

const TONE_WORDS =
  /\b(ton|tonalit[aä]t|klingt|klingen|wirkt|wirken|locker\w*|sachlich\w*|freundlich\w*|herzlich\w*|nahbar\w*|seri[oö]s\w*|professionell\w*|humor\w*|direkt\w*|pers[oö]nlich\w*|bodenst[aä]ndig\w*|ehrlich\w*|warm\w*|ruhig\w*|fachlich\w*|f[oö]rmlich\w*|unkompliziert\w*|empathisch\w*|respektvoll\w*)\b/i;
const AVOID_WORDS =
  /\b(nicht|nie|niemals|kein\w*|vermeid\w*|verbot\w*|tabu\w*|no-?go\w*|ungern|st[oö]rt|verzicht\w*)\b/i;
const QUOTED = /„([^“”"„]{1,60})[“”"]|"([^"]{1,60})"|»([^«]{1,60})«|‚([^‘’]{1,60})[‘’]/g;
const ANREDE_WORD = /^(du|sie|ihr|dich|dir|ihnen)$/i;

function suggestTonalitaet(text: string): string {
  const candidates = sentences(text).filter(
    (s) => !/[„"»‚]/.test(s) && !DU_EXPLICIT.test(s) && !SIE_EXPLICIT.test(s),
  );
  const tone = candidates.filter((s) => TONE_WORDS.test(s)).slice(0, 2);
  const picked = tone.length > 0 ? tone : candidates.slice(0, 1);
  return picked.join(" ").slice(0, 280).trim();
}

function suggestVerboteneWoerter(text: string): string[] {
  const words: string[] = [];
  for (const sentence of sentences(text)) {
    if (!AVOID_WORDS.test(sentence)) continue;
    for (const match of sentence.matchAll(QUOTED)) {
      const word = cleanWord(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
      if (word && !ANREDE_WORD.test(word) && word.split(" ").length <= 4) words.push(word);
    }
  }
  return dedupe(words).slice(0, WORDS_MAX);
}

/**
 * Pre-fill for the "Einstellungen für Texte" card. Simple keyword heuristics over the
 * "sprache" (anrede, tonalitaet, verbotene_woerter) and "unternehmen" (branche) sections.
 * Only a suggestion: a person confirms the values before anything is sent.
 */
export function suggestTextSettings(
  items: readonly WorkshopAnbieterSection[],
): ContentTextSettingsSuggestion {
  const sprache = sectionOf(items, "sprache");
  const unternehmen = sectionOf(items, "unternehmen");
  const reasons: ContentTextSettingsSuggestion["reasons"] = {};

  const anrede = suggestAnrede(sprache.text);
  if (anrede.match) reasons.anrede = `„${anrede.match}“ in „${sprache.label}“`;

  const branche = suggestBranche(unternehmen.text);
  if (branche.match) reasons.branche = `„${branche.match}“ in „${unternehmen.label}“`;

  const tonalitaet = suggestTonalitaet(sprache.text);
  if (tonalitaet) reasons.tonalitaet = `aus „${sprache.label}“`;

  const verboteneWoerter = suggestVerboteneWoerter(sprache.text);
  if (verboteneWoerter.length > 0) reasons.verbotene_woerter = `aus „${sprache.label}“`;

  return {
    settings: {
      anrede: anrede.value,
      branche: branche.value,
      tonalitaet,
      verbotene_woerter: verboteneWoerter,
    },
    reasons,
  };
}

/**
 * `dt_agents` row → Content-Agent `avatar` object.
 * Row columns win over same-named keys inside `avatar_data`.
 */
export function avatarFromAgent(row: DtAgentForContent): ContentAvatar {
  const extra = isRecord(row.avatar_data) ? row.avatar_data : {};
  return {
    ...extra,
    name: row.name.trim(),
    role: (row.role ?? "").trim(),
    beschreibung: (row.prompt_template ?? "").trim(),
  };
}

/** `{org}` path segment for the Content-Agent. */
export function contentClientKey(organisationId: string): string {
  return organisationId.trim().toLowerCase();
}
