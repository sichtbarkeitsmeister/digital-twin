/**
 * Page roles and page types of the Texte pipeline, ported from the old Step-by-Step
 * Content-Agent (`derive_page_type` in its importer). Pure: no Supabase, no Node APIs, so
 * client components and tests may use it.
 *
 * - role: where the page sits in the Excel-Seitenstruktur (Startseite, Ebene 1 = pillar,
 *   Ebene 2 = supporting). Crawl pages have no role.
 * - type: which writing variant the SEO step uses. Derived from role, pillar and name;
 *   the editor may override it in the drawer.
 */

export const CONTENT_PAGE_ROLES = ["startseite", "pillar", "supporting"] as const;
export type ContentPageRole = (typeof CONTENT_PAGE_ROLES)[number];

export const CONTENT_PAGE_TYPES = ["hauptsilo", "unterseite", "ratgeber", "standort", "nicht_bearbeiten"] as const;
export type ContentPageType = (typeof CONTENT_PAGE_TYPES)[number];

export const CONTENT_PAGE_TYPE_LABELS: Record<ContentPageType, string> = {
  hauptsilo: "Hauptsilo-Seite",
  unterseite: "Unterseite",
  ratgeber: "Ratgeberartikel",
  standort: "Standortseite",
  nicht_bearbeiten: "Nicht bearbeiten",
};

export const CONTENT_PAGE_ROLE_LABELS: Record<ContentPageRole, string> = {
  startseite: "Startseite",
  pillar: "Hauptsilo (Ebene 1)",
  supporting: "Unterseite (Ebene 2)",
};

export function isContentPageType(value: unknown): value is ContentPageType {
  return typeof value === "string" && (CONTENT_PAGE_TYPES as readonly string[]).includes(value);
}

export function isContentPageRole(value: unknown): value is ContentPageRole {
  return typeof value === "string" && (CONTENT_PAGE_ROLES as readonly string[]).includes(value);
}

export function contentPageTypeLabel(type: string | null | undefined): string {
  return isContentPageType(type) ? CONTENT_PAGE_TYPE_LABELS[type] : "Noch nicht bestimmt";
}

/** Lowercase, umlauts folded, one space between words: „Über uns“ → „ueber uns“. */
export function normalizePageName(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Legal and organisational pages the old importer skipped (`EXCLUDED`): they get no text.
 * Matched against the normalised page name and the last path segment, as a whole or as the
 * leading words („Kontakt & Anfahrt“, „Über uns – das Team“).
 */
export const CONTENT_EXCLUDED_PAGE_NAMES = [
  "impressum",
  "datenschutz",
  "datenschutzerklaerung",
  "karriere",
  "kontakt",
  "ueber uns",
  "zertifizierungen",
  "unsere partner",
  "referenzen",
  "agb",
] as const;

export function isExcludedContentPageName(name: string, path?: string | null): boolean {
  const candidates = [normalizePageName(name)];
  const segment = path?.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  if (segment) candidates.push(normalizePageName(decodeSafe(segment)));
  return candidates.some((candidate) =>
    CONTENT_EXCLUDED_PAGE_NAMES.some((excluded) => candidate === excluded || candidate.startsWith(`${excluded} `)),
  );
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const RATGEBER_RE = /ratgeber|\bblog\b|\bmagazin\b|\bwissen(swertes)?\b|\btipps\b/i;
const REGIONEN_RE = /\bregion(en)?\b|\bstandorte?\b|\beinzugsgebiet\b/i;

export type DerivePageTypeInput = {
  name: string;
  role: ContentPageRole | null;
  pillarName?: string | null;
  path?: string | null;
  /** Cities the Anbieterfakten mention; a page named after one is a Standortseite. */
  cities?: readonly string[];
};

/** `derive_page_type` of the old importer, for pages from the Excel-Seitenstruktur. */
export function derivePageType(input: DerivePageTypeInput): ContentPageType {
  const name = input.name.trim();
  if (isExcludedContentPageName(name, input.path)) return "nicht_bearbeiten";
  const pillar = input.pillarName?.trim() ?? "";
  if (RATGEBER_RE.test(pillar) || RATGEBER_RE.test(name)) return "ratgeber";
  if (REGIONEN_RE.test(pillar) || mentionsCity(name, input.cities ?? [])) return "standort";
  if (input.role === "pillar" || input.role === "startseite") return "hauptsilo";
  if (input.role === "supporting") return "unterseite";
  return "unterseite";
}

/**
 * Crawl pages have no role: the depth of the path decides. Nested pages are Unterseiten,
 * top-level pages Hauptsilo-Seiten; Ratgeber and excluded names as for the Excel.
 */
export function guessCrawlPageType(input: {
  name: string;
  path: string | null;
  level: number;
  cities?: readonly string[];
}): ContentPageType {
  if (isExcludedContentPageName(input.name, input.path)) return "nicht_bearbeiten";
  if (RATGEBER_RE.test(input.name) || RATGEBER_RE.test(input.path ?? "")) return "ratgeber";
  if (mentionsCity(input.name, input.cities ?? [])) return "standort";
  return input.level >= 2 ? "unterseite" : "hauptsilo";
}

/** Type to write with when a row has none yet (rows from before the briefing migration). */
export function effectiveContentPageType(page: {
  page_type: ContentPageType | null;
  page_role?: ContentPageRole | null;
  level: number;
  name: string;
  path?: string | null;
}): ContentPageType {
  if (page.page_type) return page.page_type;
  if (page.page_role) return derivePageType({ name: page.name, role: page.page_role, path: page.path });
  return guessCrawlPageType({ name: page.name, path: page.path ?? null, level: page.level });
}

function mentionsCity(name: string, cities: readonly string[]): boolean {
  if (cities.length === 0) return false;
  const haystack = ` ${normalizePageName(name)} `;
  return cities.some((city) => {
    const needle = normalizePageName(city);
    return needle.length >= 3 && haystack.includes(` ${needle} `);
  });
}

/**
 * „aus Düsseldorf“, „in der Region Düsseldorf“, „Raum Frankfurt am Main“, „bei Bad Homburg“.
 * Case-sensitive on purpose: the place must start with a capital letter, the lead-in words
 * are listed in both spellings.
 */
const CITY_PREPOSITION_RE =
  /(?:^|[\s(,;:–—-])(?:[Ii]n|[Aa]us|[Bb]ei|[Nn]ahe|[Rr]und um|[Rr]aum|[Gg]ro(?:ß|ss)raum|[Rr]egion|[Ss]tandorte?|[Ss]itz|[Kk]reis|[Ll]andkreis|[Ss]tadt|[Gg]emeinde|[Uu]mgebung von|[Uu]mkreis von)\s+(?:(?:der|dem|den|des|die|das)\s+)?(?:(?:Region|Stadt|Raum|Großraum|Grossraum|Kreis|Landkreis|Gemeinde|Metropolregion)\s+)?((?:(?:Bad|Sankt|St\.|Neu|Alt|Groß|Klein)\s+)?[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-ZÄÖÜ][a-zäöüß]{2,})*(?:\s+(?:am|an|im|ob|auf|bei|vor)(?:\s+der)?\s+[A-ZÄÖÜ][a-zäöüß]{2,})?)/g;

const NOT_A_CITY = new Set(
  [
    "Ihrem", "Ihrer", "Ihren", "Ihre", "Unserem", "Unserer", "Unseren", "Unsere", "Diesem", "Dieser", "Diesen", "Jedem", "Jeder",
    "Allen", "Alle", "Aller", "Vielen", "Mehreren", "Einem", "Einer", "Zwei", "Drei", "Vier", "Haus", "Wohnung", "Keller",
    "Betrieb", "Büro", "Praxis", "Kanzlei", "Firma", "Unternehmen", "Team", "Region", "Regel", "Zukunft", "Vergangenheit",
    "Deutschland", "Österreich", "Schweiz", "Europa", "Bayern", "Hessen", "Sachsen", "Nähe", "Umgebung", "Umkreis", "Nachbarschaft",
    "Werkstatt", "Lager", "Garten", "Zusammenarbeit", "Kombination", "Verbindung", "Absprache", "Kürze", "Folge", "Ruhe",
    "Sachen", "Punkto", "Bezug", "Hinblick", "Notfall", "Notfällen", "Ausnahmefällen", "Einzelfall", "Einzelfällen",
    "Allgemeinen", "Wesentlichen", "Vordergrund", "Mittelpunkt", "Hintergrund", "Rahmen", "Form", "Höhe", "Nähe",
    "Anspruch", "Auftrag", "Angebot", "Sommer", "Winter", "Frühjahr", "Herbst", "Woche", "Wochen", "Monat", "Monaten", "Jahr", "Jahren",
    "Wir", "Sie", "Ich", "Es", "Der", "Die", "Das",
  ].map((w) => w.toLowerCase()),
);

/**
 * Conservative guess which cities the Anbieterfakten name: capitalised words after „in“, „aus“,
 * „Raum“, „Region“ … („Familienbetrieb aus Düsseldorf“ → Düsseldorf). Only used to call a page
 * named after such a place a Standortseite; a wrong guess costs one click in the drawer.
 */
export function extractCityCandidates(text: string, limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(CITY_PREPOSITION_RE)) {
    const candidate = (match[1] ?? "").replace(/\s+/g, " ").trim();
    const key = candidate.toLowerCase();
    if (!candidate || seen.has(key) || NOT_A_CITY.has(key) || NOT_A_CITY.has(key.split(/[\s-]/)[0]!)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}
