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

/** Prefer explicit slug; otherwise derive from organisation name. */
export function resolveOrganisationSlug(input: {
  slug?: string | null;
  name?: string | null;
}): string | null {
  const explicit = String(input.slug ?? "")
    .trim()
    .toLowerCase();
  if (explicit && /^[a-z0-9-]+$/.test(explicit)) return explicit.slice(0, 64);

  const fromName = slugifyOrganisationName(String(input.name ?? ""));
  return fromName || null;
}
