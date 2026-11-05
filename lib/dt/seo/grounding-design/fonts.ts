/**
 * Fonts of the Grounding Page design. GDPR rule (Germany): a page may only load the
 * website's font when it is self-hosted on the client's own domain. Fonts from Google Fonts,
 * Adobe Fonts or other CDNs are never loaded; they map to the closest system font stack.
 * Pure and browser-safe.
 */

export type SystemStackKey = "sans" | "serif" | "slab" | "mono";

/** The neutral template's font (unchanged since the first Grounding Page). */
export const NEUTRAL_FONT_STACK = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

export const SYSTEM_STACKS: Record<SystemStackKey, { label: string; stack: string }> = {
  sans: { label: "Systemschrift ohne Serifen", stack: NEUTRAL_FONT_STACK },
  serif: { label: "Systemschrift mit Serifen", stack: 'Georgia,Cambria,"Times New Roman",Times,serif' },
  slab: { label: "Serifenbetonte Systemschrift (Slab)", stack: 'Rockwell,"Roboto Slab","DejaVu Serif",Georgia,serif' },
  mono: { label: "Monospace-Systemschrift", stack: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace' },
};

export const SYSTEM_STACK_KEYS = Object.keys(SYSTEM_STACKS) as SystemStackKey[];

/** Common web fonts and the system stack closest to them. */
const KNOWN_FONTS: Record<string, SystemStackKey> = {};
const register = (key: SystemStackKey, names: string[]) => names.forEach((n) => (KNOWN_FONTS[n] = key));
register("sans", [
  "montserrat",
  "open sans",
  "roboto",
  "lato",
  "poppins",
  "inter",
  "nunito",
  "nunito sans",
  "raleway",
  "source sans pro",
  "source sans 3",
  "work sans",
  "noto sans",
  "ubuntu",
  "oswald",
  "pt sans",
  "mulish",
  "barlow",
  "rubik",
  "dm sans",
  "manrope",
  "figtree",
  "outfit",
  "quicksand",
  "josefin sans",
  "titillium web",
  "fira sans",
  "heebo",
  "karla",
  "hind",
  "cabin",
  "archivo",
  "exo 2",
  "assistant",
  "kanit",
  "jost",
  "plus jakarta sans",
  "red hat display",
  "ibm plex sans",
  "asap",
  "catamaran",
  "lexend",
  "sora",
  "urbanist",
  "be vietnam pro",
]);
register("serif", [
  "playfair display",
  "merriweather",
  "lora",
  "pt serif",
  "libre baskerville",
  "cormorant",
  "cormorant garamond",
  "eb garamond",
  "noto serif",
  "crimson text",
  "crimson pro",
  "source serif pro",
  "source serif 4",
  "dm serif display",
  "dm serif text",
  "spectral",
  "libre caslon text",
  "frank ruhl libre",
  "prata",
  "cardo",
  "vollkorn",
  "alegreya",
  "ibm plex serif",
]);
register("slab", ["roboto slab", "zilla slab", "arvo", "bitter", "josefin slab", "slabo 27px", "slabo 13px", "crete round", "rokkitt", "aleo", "noticia text", "kreon"]);
register("mono", [
  "roboto mono",
  "source code pro",
  "fira code",
  "fira mono",
  "jetbrains mono",
  "ibm plex mono",
  "space mono",
  "inconsolata",
  "dm mono",
  "ubuntu mono",
  "courier prime",
]);

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
]);

/** Installed on the reader's device; using them loads nothing. */
const SYSTEM_FAMILIES = new Set([
  "arial",
  "helvetica",
  "helvetica neue",
  "georgia",
  "times new roman",
  "times",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "segoe ui",
  "segoe ui variable",
  "courier new",
  "courier",
  "palatino",
  "palatino linotype",
  "book antiqua",
  "cambria",
  "calibri",
  "candara",
  "consolas",
  "lucida grande",
  "lucida sans unicode",
  "gill sans",
  "optima",
  "menlo",
  "monaco",
  "sfmono-regular",
  "sf pro text",
  "sf pro display",
  "avenir",
  "avenir next",
  "liberation sans",
  "liberation serif",
  "dejavu sans",
  "dejavu serif",
  "noto color emoji",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "rockwell",
  "garamond",
  "baskerville",
  "didot",
  "futura",
  "franklin gothic medium",
  "century gothic",
  "impact",
]);

/** Icon fonts are never a body or heading font. */
const ICON_FONT = /(awesome|dashicons|eicons|etmodules|icomoon|material icons|material symbols|glyphicons|ionicons|fontello|elementskit|themify|feather|bootstrap-icons|genericons|astra|kadence-icons)/i;

/** Only letters, digits, spaces, dots, hyphens and underscores survive (CSS injection guard). */
export function sanitizeFamilyName(name: string): string {
  return name
    .replace(/^["']|["']$/g, "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** „"Open Sans", Arial, sans-serif“ → ["Open Sans", "Arial", "sans-serif"]. */
export function parseFontFamilyList(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of value.replace(/\s*!important\s*$/i, "")) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((f) => sanitizeFamilyName(f)).filter((f) => f && !CSS_WIDE_KEYWORDS.has(f.toLowerCase()));
}

/** „inherit“ & co. are no font names. */
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "default", "none"]);

export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLowerCase());
}

export function isSystemFamily(name: string): boolean {
  const n = name.toLowerCase();
  return GENERIC_FAMILIES.has(n) || SYSTEM_FAMILIES.has(n);
}

export function isIconFont(name: string): boolean {
  return ICON_FONT.test(name);
}

/** Closest system stack for a family (and the rest of its declared stack). */
export function systemStackKeyFor(name: string, declared: string[] = []): SystemStackKey {
  const n = name.toLowerCase();
  const known = KNOWN_FONTS[n];
  if (known) return known;
  if (/slab/.test(n)) return "slab";
  if (/mono|code|courier/.test(n)) return "mono";
  const generics = declared.map((d) => d.toLowerCase());
  if (generics.includes("monospace") || generics.includes("ui-monospace")) return "mono";
  if (generics.includes("serif") || generics.includes("ui-serif")) return "serif";
  if (/serif|garamond|baskerville|times|georgia|caslon|bodoni|didot/.test(n) && !/sans/.test(n)) return "serif";
  return "sans";
}

export function quoteFamily(name: string): string {
  const clean = sanitizeFamilyName(name);
  if (!clean) return "";
  if (isGenericFamily(clean)) return clean.toLowerCase();
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(clean) ? clean : `"${clean}"`;
}

/** A font stack from family names: sanitised, quoted, at most eight entries. */
export function buildFontStack(families: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of families) {
    const q = quoteFamily(f);
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out.join(",");
}

/** A declared stack that only names fonts installed on the device (nothing loads). */
export function systemOnlyStack(declared: string[]): string | null {
  const families = declared.filter((f) => isSystemFamily(f) && !isIconFont(f));
  if (families.length === 0) return null;
  const hasGeneric = families.some((f) => isGenericFamily(f));
  return buildFontStack(hasGeneric ? families : [...families, "sans-serif"]);
}

/** Hosts that serve web fonts or font CSS from outside the client's domain. */
export const EXTERNAL_FONT_HOSTS =
  /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|use\.typekit\.com|fonts\.bunny\.net|fast\.fonts\.net|cloud\.typography\.com|fonts\.cdnfonts\.com|api\.fontshare\.com|cdn\.fontshare\.com|webfonts\.fontslive\.com|fonts\.adobe\.com|use\.fontawesome\.com)$/i;

/** Family names requested from Google Fonts / Bunny Fonts stylesheet URLs. */
export function familiesFromFontServiceUrl(url: string): string[] {
  try {
    const u = new URL(url);
    if (!EXTERNAL_FONT_HOSTS.test(u.hostname)) return [];
    const families = u.searchParams.getAll("family");
    return families
      .flatMap((f) => f.split("|"))
      .map((f) => sanitizeFamilyName(f.split(":")[0]!.replace(/\+/g, " ")))
      .filter(Boolean);
  } catch {
    return [];
  }
}
