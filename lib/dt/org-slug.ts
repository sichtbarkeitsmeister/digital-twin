/**
 * URL-/client-safe organisation slug (SEO n8n `client`, portal keys).
 * Matches legacy `toClientSlug` / {@link legacyClientSlug} rules.
 */
export function slugifyOrganisationName(name: string): string {
  const slug = name
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

  return slug.slice(0, 64);
}

/**
 * Prefer explicit slug; otherwise derive from organisation name.
 * Free-form slug input (spaces, umlauts, legal suffixes) is slugified the same
 * way as the organisation name — users often paste the company name into the slug field.
 */
export function resolveOrganisationSlug(input: {
  slug?: string | null;
  name?: string | null;
}): string | null {
  const explicitRaw = String(input.slug ?? "").trim();
  if (explicitRaw) {
    if (/^[a-z0-9-]+$/i.test(explicitRaw)) {
      return explicitRaw.toLowerCase().slice(0, 64);
    }
    const fromExplicit = slugifyOrganisationName(explicitRaw);
    if (fromExplicit) return fromExplicit;
  }

  const fromName = slugifyOrganisationName(String(input.name ?? ""));
  return fromName || null;
}
