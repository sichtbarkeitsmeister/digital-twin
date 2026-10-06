/**
 * DigitalTwin data → the `anbieter` / `avatar` objects the content pipeline writes from.
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

/**
 * Tone options. Each sits in a different corner of formal ↔ casual, warm ↔ sober and
 * calm ↔ lively, so a wrong pick is obvious and every common site has a fit.
 * `text` is what the pipeline receives as `tonalitaet`; `keywords` drive the suggestion.
 */
export const CONTENT_TONALITAETEN = [
  {
    key: "sachlich",
    label: "Sachlich & präzise",
    short: "Nüchtern, fachlich, ohne Werbesprache",
    text: "Nüchtern und fachlich. Klare Aussagen, Fachbegriffe werden erklärt, keine Werbesprache und keine Emotionalisierung.",
    keywords:
      /\b(sachlich\w*|n[üu]chtern\w*|pr[äa]zise\w*|fachlich\w*|faktisch\w*|neutral\w*|informativ\w*|technisch\w*|objektiv\w*)\b/gi,
  },
  {
    key: "serioes",
    label: "Seriös & vertrauensvoll",
    short: "Ruhig, kompetent, gibt Sicherheit",
    text: "Ruhig und zugewandt. Vermittelt Kompetenz und Sicherheit, nimmt Sorgen ernst, ohne zu dramatisieren. Förmlich, aber nicht steif.",
    keywords:
      /\b(seri[öo]s\w*|vertrauen\w*|kompeten\w*|souver[äa]n\w*|professionell\w*|verl[äa]sslich\w*|zuverl[äa]ssig\w*|sicherheit|diskret\w*)\b/gi,
  },
  {
    key: "herzlich",
    label: "Herzlich & bodenständig",
    short: "Warm, nahbar, wie aus der Nachbarschaft",
    text: "Warm und nahbar. Spricht wie ein Mensch aus der Nachbarschaft: ehrlich, unaufgeregt, ohne Fachjargon und ohne Übertreibung.",
    keywords:
      /\b(herzlich\w*|warm\w*|nahbar\w*|bodenst[äa]ndig\w*|ehrlich\w*|famili[äa]r\w*|pers[öo]nlich\w*|menschlich\w*|unaufgeregt\w*|authentisch\w*|sympathisch\w*)\b/gi,
  },
  {
    key: "direkt",
    label: "Direkt & unkompliziert",
    short: "Kurz, klar, sofort zum Punkt",
    text: "Kurz und klar. Kommt sofort zum Punkt, nennt Preise und Abläufe offen, kurze Sätze, keine Floskeln.",
    keywords:
      /\b(direkt\w*|auf den punkt|klar\w*|kurz\w*|knapp\w*|unkompliziert\w*|geradeaus|offen\w*|ohne umschweife|pragmatisch\w*|schn[öo]rkellos\w*)\b/gi,
  },
  {
    key: "locker",
    label: "Locker & humorvoll",
    short: "Leicht, mit Augenzwinkern",
    text: "Leicht und mit Augenzwinkern. Lockere Alltagssprache, kleine Pointen erlaubt, in den Fakten trotzdem verlässlich.",
    keywords:
      /\b(locker\w*|humor\w*|witzig\w*|augenzwinkern\w*|l[äa]ssig\w*|frech\w*|leicht\w*|flapsig\w*|jugendlich\w*|salopp\w*|lustig\w*)\b/gi,
  },
  {
    key: "einfuehlsam",
    label: "Einfühlsam & behutsam",
    short: "Rücksichtsvoll, für schwierige Situationen",
    text: "Behutsam und respektvoll. Für schwierige Lebenslagen: nimmt Rücksicht, drängt nicht, erklärt Schritt für Schritt, ohne Pathos.",
    keywords:
      /\b(einf[üu]hlsam\w*|behutsam\w*|ruhig\w*|respektvoll\w*|sensibel\w*|r[üu]cksicht\w*|empathisch\w*|taktvoll\w*|w[üu]rdevoll\w*|piet[äa]t\w*|mitf[üu]hlend\w*)\b/gi,
  },
  {
    key: "premium",
    label: "Gehoben & anspruchsvoll",
    short: "Elegant, betont Qualität und Sorgfalt",
    text: "Gehoben und zurückhaltend. Betont Qualität, Sorgfalt und Erfahrung, spricht anspruchsvolle Kunden an, ohne Superlative.",
    keywords:
      /\b(premium|gehoben\w*|exklusiv\w*|hochwertig\w*|elegan\w*|anspruchsvoll\w*|edel\w*|stilvoll\w*|luxuri[öo]s\w*|erlesen\w*)\b/gi,
  },
  {
    key: "energisch",
    label: "Energisch & begeistert",
    short: "Lebendig, motivierend, aktiv",
    text: "Lebendig und motivierend. Zeigt Begeisterung für die Sache, aktive Sprache, kurze Impulse, lädt zum Mitmachen ein.",
    keywords:
      /\b(energisch\w*|begeister\w*|lebendig\w*|motivier\w*|dynamisch\w*|mitrei[ßs]end\w*|enthusiast\w*|schwungvoll\w*|leidenschaft\w*|inspirier\w*)\b/gi,
  },
] as const;

export type ContentTonalitaet = (typeof CONTENT_TONALITAETEN)[number]["key"];
export const CONTENT_TONALITAET_KEYS = CONTENT_TONALITAETEN.map((t) => t.key) as [
  ContentTonalitaet,
  ...ContentTonalitaet[],
];

const DEFAULT_TONALITAET: Record<ContentBranche, ContentTonalitaet> = {
  handwerk: "herzlich",
  rechtsanwalt: "serioes",
  arzt: "einfuehlsam",
};

export function contentTonalitaet(key: string) {
  return CONTENT_TONALITAETEN.find((t) => t.key === key) ?? null;
}

/** The `tonalitaet` string the pipeline prompts carry. */
export function contentTonalitaetText(key: ContentTonalitaet): string {
  const tone = contentTonalitaet(key) ?? CONTENT_TONALITAETEN[0];
  return `${tone.label}: ${tone.text}`;
}

export type ContentTextSettings = {
  anrede: ContentAnrede;
  branche: ContentBranche;
  tonalitaet: ContentTonalitaet;
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

export type ContentAnbieterPayload = Omit<ContentTextSettings, "tonalitaet"> & {
  name: string;
  tonalitaet: string;
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
 * Workshop sections → `anbieter` object: every filled section under its key as free
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
    tonalitaet: contentTonalitaetText(clean.tonalitaet),
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
  const branche = (CONTENT_BRANCHEN as readonly string[]).includes(settings.branche)
    ? settings.branche
    : "handwerk";
  return {
    anrede: settings.anrede === "Du" ? "Du" : "Sie",
    branche,
    tonalitaet: contentTonalitaet(settings.tonalitaet)?.key ?? DEFAULT_TONALITAET[branche],
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

const AVOID_WORDS =
  /\b(nicht|nie|niemals|kein\w*|vermeid\w*|verbot\w*|tabu\w*|no-?go\w*|ungern|st[oö]rt|verzicht\w*)\b/i;
/** "nie flapsig", "nicht zu locker", "keine Witze": the negated words must not score. */
const NEGATED_PHRASE = /\b(nicht|nie|niemals|kein\w*|ohne|statt|weder)\b(\s+\w+){1,3}/gi;
const QUOTED = /„([^“”"„]{1,60})[“”"]|"([^"]{1,60})"|»([^«]{1,60})«|‚([^‘’]{1,60})[‘’]/g;
const ANREDE_WORD = /^(du|sie|ihr|dich|dir|ihnen)$/i;

function suggestTonalitaet(
  text: string,
  branche: ContentBranche,
): { value: ContentTonalitaet; matches: string[] } {
  const positive = text.replace(QUOTED, " ").replace(NEGATED_PHRASE, " ");
  let best: { value: ContentTonalitaet; matches: string[] } | null = null;
  for (const tone of CONTENT_TONALITAETEN) {
    const matches = dedupe([...positive.matchAll(tone.keywords)].map((m) => m[0]));
    if (matches.length > 0 && matches.length > (best?.matches.length ?? 0)) {
      best = { value: tone.key, matches };
    }
  }
  return best ?? { value: DEFAULT_TONALITAET[branche], matches: [] };
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

  const tonalitaet = suggestTonalitaet(sprache.text, branche.value);
  if (tonalitaet.matches.length > 0) {
    const quoted = tonalitaet.matches.slice(0, 3).map((m) => `„${m}“`).join(", ");
    reasons.tonalitaet = `${quoted} in „${sprache.label}“`;
  }

  const verboteneWoerter = suggestVerboteneWoerter(sprache.text);
  if (verboteneWoerter.length > 0) reasons.verbotene_woerter = `aus „${sprache.label}“`;

  return {
    settings: {
      anrede: anrede.value,
      branche: branche.value,
      tonalitaet: tonalitaet.value,
      verbotene_woerter: verboteneWoerter,
    },
    reasons,
  };
}

/**
 * `dt_agents` row → `avatar` object for the pipeline prompts.
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

