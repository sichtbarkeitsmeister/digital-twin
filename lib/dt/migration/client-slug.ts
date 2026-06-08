/** Matches legacy `toClientSlug` in old digitaltwin/seo-admin/index.html */
export function legacyClientSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/gebr\.\s*/g, "")
    .replace(/\bgmbh\b|\bug\b|\bag\b|\be\.v\.\b|\bgbr\b|\bco\.\b|\bkg\b/g, "")
    .replace(/ü/g, "ue")
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Normalise legacy `client` values (typos like `=roggendorf`). */
export function normalizeLegacyClient(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let c = String(raw).trim();
  if (!c || c === "=") return null;
  if (c.startsWith("=")) c = c.slice(1).trim();
  if (/^FEHLER/i.test(c) || c.toLowerCase().includes("kein client")) return null;
  c = c.replace(/-team$/i, "").replace(/&mode=seo/i, "");
  return c || null;
}

export function resolveLegacyClientKey(row: Record<string, unknown>): string | null {
  const explicit = normalizeLegacyClient(String(row.client ?? row.client_id ?? ""));
  if (explicit) return explicit;
  const kunde = String(row.kunde ?? row.client_name ?? "").trim();
  if (kunde) return legacyClientSlug(kunde);
  return null;
}

/** Strip legacy spreadsheet/export prefix (`=Haemo…` → `Haemo…`). */
export function stripLegacyEqualsPrefix(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  while (s.startsWith("=")) s = s.slice(1).trim();
  return s;
}

const WEBSITE_CLIENT_HINTS: Array<{ slug: string; patterns: RegExp[] }> = [
  {
    slug: "naturheilpraxis-weber",
    patterns: [/weber/i, /naturheilpraxis/i, /h[aä]emo-?laser/i, /heilpraktiker-weber/i],
  },
];

/** Resolve org slug for `website_content` when `client` is `=` or missing. */
export function resolveWebsiteContentClient(row: Record<string, unknown>): string | null {
  const fromClient = resolveLegacyClientKey(row);
  if (fromClient) return fromClient;

  const blob = [row.title, row.h1, row.meta_description, row.text_content, row.content, row.url]
    .map((v) => stripLegacyEqualsPrefix(String(v ?? "")))
    .join(" ");

  for (const { slug, patterns } of WEBSITE_CLIENT_HINTS) {
    if (patterns.some((p) => p.test(blob))) return slug;
  }
  return null;
}

const WEBSITE_DEFAULT_URL: Record<string, string> = {
  "naturheilpraxis-weber": "https://www.heilpraktiker-weber-koeln.de",
};

export function resolveWebsiteContentUrl(
  row: Record<string, unknown>,
  clientSlug: string | null,
): string | null {
  const raw = stripLegacyEqualsPrefix(String(row.url ?? ""));
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  if (clientSlug && WEBSITE_DEFAULT_URL[clientSlug]) return WEBSITE_DEFAULT_URL[clientSlug];
  return null;
}
