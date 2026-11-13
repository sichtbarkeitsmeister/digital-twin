/**
 * Comparing keywords across pages, and spotting entries that are no keywords at all. Pure (no
 * server imports): the Keywords-Übersicht in the browser, the analysis and the API all use it.
 *
 * Two pages that aim at the same main keyword compete with each other and, with similar texts,
 * produce duplicate content. „Gleich“ is the same search in other spelling (case, punctuation,
 * word order, small words like „in“ or „für“, split or compound: „Silber Ankauf“ = „Silberankauf“).
 * „Ähnlich“ adds simple German inflection („Antiquitäten“ ~ „Antiquität“).
 */

const STOP_WORDS = new Set(["in", "im", "für", "fuer", "und", "der", "die", "das", "den", "dem", "des", "bei", "von", "zu", "zum", "zur", "mit", "am", "an", "auf", "aus", "nach", "ein", "eine", "einer", "oder"]);

/** The wording alone: lowercase, no punctuation, one space. The old exact comparison. */
export function keywordKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(text: string): string[] {
  return keywordKey(text.replace(/ß/g, "ss"))
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));
}

const FOLD: Record<string, string> = { ä: "a", ö: "o", ü: "u" };
const SUFFIXES = ["innen", "ern", "en", "er", "es", "e", "n", "s"];

/** A light German stem: umlauts folded, one inflection ending off long words. */
function stem(token: string): string {
  const folded = token.replace(/[äöü]/g, (c) => FOLD[c] ?? c);
  if (folded.length <= 5) return folded;
  for (const suffix of SUFFIXES) {
    if (folded.endsWith(suffix) && folded.length - suffix.length >= 5) return folded.slice(0, -suffix.length);
  }
  return folded;
}

/** Same words in any order. */
export function keywordSameKey(text: string): string {
  return tokens(text).sort().join(" ");
}

/** The words run together in their order: „Silber Ankauf“ and „Silberankauf“ meet. */
export function keywordCompactKey(text: string): string {
  return tokens(text).join("");
}

/** Same words in any order, inflection folded. */
export function keywordLikeKey(text: string): string {
  return tokens(text).map(stem).sort().join(" ");
}

export type KeywordMatchLevel = "gleich" | "aehnlich";

/** How alike two keywords are: the same search („gleich“), the same search but for inflection („aehnlich“), or not. */
export function keywordMatch(a: string, b: string): KeywordMatchLevel | null {
  const sameA = keywordSameKey(a);
  if (!sameA) return null;
  if (sameA === keywordSameKey(b)) return "gleich";
  const compactA = keywordCompactKey(a);
  if (compactA && compactA === keywordCompactKey(b)) return "gleich";
  const likeA = keywordLikeKey(a);
  if (likeA && likeA === keywordLikeKey(b)) return "aehnlich";
  const compactStemA = tokens(a).map(stem).join("");
  if (compactStemA && compactStemA === tokens(b).map(stem).join("")) return "aehnlich";
  return null;
}

/** Whether `text` matches any of `others` at least as closely as `similar` asks. */
export function keywordTaken(text: string, others: readonly string[], similar: boolean): boolean {
  return others.some((o) => {
    const level = keywordMatch(text, o);
    return level === "gleich" || (similar && level === "aehnlich");
  });
}

export type KeywordPageInput = { slug: string; name: string; main: string | null; secondary: readonly string[] };

export type KeywordConflict = {
  /** `haupt_haupt`: both pages have it as main keyword. `haupt_neben`: this page's main keyword is a Nebenkeyword of the other. `neben_haupt`: the other page's main keyword is a Nebenkeyword of this one. */
  kind: "haupt_haupt" | "haupt_neben" | "neben_haupt";
  level: KeywordMatchLevel;
  keyword: string;
  otherKeyword: string;
  otherSlug: string;
  otherName: string;
};

const BUCKET_MAX = 40;

/**
 * Every page that competes with another for a keyword: same or similar main keywords, and a main
 * keyword that another page carries as a Nebenkeyword. Keyed by slug; pages without a conflict
 * are absent. Buckets by key first, so hundreds of pages cost no pairwise comparison.
 */
export function findKeywordConflicts(pages: readonly KeywordPageInput[]): Map<string, KeywordConflict[]> {
  const out = new Map<string, KeywordConflict[]>();
  const seen = new Set<string>();
  const push = (slug: string, c: KeywordConflict) => {
    const id = `${slug}|${c.kind}|${c.otherSlug}|${keywordKey(c.keyword)}|${keywordKey(c.otherKeyword)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.set(slug, [...(out.get(slug) ?? []), c]);
  };
  const keysOf = (text: string) => [keywordSameKey(text), keywordCompactKey(text), keywordLikeKey(text), tokens(text).map(stem).join("")].filter(Boolean);

  const mains = new Map<string, Array<{ page: KeywordPageInput; text: string }>>();
  const secondaries = new Map<string, Array<{ page: KeywordPageInput; text: string }>>();
  for (const page of pages) {
    if (page.main?.trim()) for (const key of new Set(keysOf(page.main))) mains.set(key, [...(mains.get(key) ?? []), { page, text: page.main }]);
    for (const text of page.secondary) for (const key of new Set(keysOf(text))) secondaries.set(key, [...(secondaries.get(key) ?? []), { page, text }]);
  }

  for (const bucket of mains.values()) {
    if (bucket.length < 2) continue;
    const list = bucket.slice(0, BUCKET_MAX);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.page.slug === b.page.slug) continue;
        const level = keywordMatch(a.text, b.text);
        if (!level) continue;
        push(a.page.slug, { kind: "haupt_haupt", level, keyword: a.text, otherKeyword: b.text, otherSlug: b.page.slug, otherName: b.page.name });
        push(b.page.slug, { kind: "haupt_haupt", level, keyword: b.text, otherKeyword: a.text, otherSlug: a.page.slug, otherName: a.page.name });
      }
    }
  }

  for (const [key, mainList] of mains) {
    const secondList = secondaries.get(key);
    if (!secondList) continue;
    for (const m of mainList.slice(0, BUCKET_MAX)) {
      for (const s of secondList.slice(0, BUCKET_MAX)) {
        if (m.page.slug === s.page.slug) continue;
        const level = keywordMatch(m.text, s.text);
        if (!level) continue;
        push(m.page.slug, { kind: "haupt_neben", level, keyword: m.text, otherKeyword: s.text, otherSlug: s.page.slug, otherName: s.page.name });
        push(s.page.slug, { kind: "neben_haupt", level, keyword: s.text, otherKeyword: m.text, otherSlug: m.page.slug, otherName: m.page.name });
      }
    }
  }
  return out;
}

/** One German line for a conflict, as the overview shows it. */
export function describeKeywordConflict(c: KeywordConflict): string {
  const how = c.level === "gleich" ? "dasselbe" : "ein sehr ähnliches";
  const same = keywordKey(c.keyword) === keywordKey(c.otherKeyword) ? "" : ` („${c.otherKeyword}“)`;
  if (c.kind === "haupt_haupt") return `Hauptkeyword wie „${c.otherName}“: ${how} Hauptkeyword${same}`;
  if (c.kind === "haupt_neben") return `Das Hauptkeyword steht bei „${c.otherName}“ als Nebenkeyword${same}`;
  return `Das Nebenkeyword ist das Hauptkeyword von „${c.otherName}“${same}`;
}

/**
 * Why an entry is no keyword, or null when it can be one: the Excel's header or description
 * cell („geschätzter Traffic bei Google / Monat“), a number, an address, a text that is far
 * too long. A phrase of „is…“ form, so it reads after „sieht nach“.
 */
export function keywordJunkReason(text: string): string | null {
  const t = text.trim();
  if (!t) return "einem leeren Eintrag";
  if (/\b(gesch[aä]tzt\w*|traffic|suchvolumen|search volume|pro monat|per month|monatlich\w*)\b/i.test(t) || /\/\s*monat\b/i.test(t)) return "einer Spaltenüberschrift oder Beschreibung";
  if (/^(keywords?|haupt\s*-?keywords?|neben\s*-?keywords?|url|seite|h1|h1-optionen|nutzerfragen|ebene\s*\d+|startseite|n\/?a|k\.?\s?a\.?|tbd|todo)$/i.test(t)) return "einer Spaltenüberschrift oder einem Platzhalter";
  if (/^[\d\s.,%/+\-–]+$/.test(t)) return "einer Zahl";
  if (/^(https?:\/\/|www\.)/i.test(t) || /^\/[\w\-/.]*$/.test(t)) return "einer Adresse";
  if (t.length > 90 || t.split(/\s+/).length > 9) return "einem zu langen Text";
  return null;
}
