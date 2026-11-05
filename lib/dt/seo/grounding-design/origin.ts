/**
 * „Own origin“ of the client's website: the same host, or the same host with/without
 * „www.“, over http(s). Self-hosted fonts must live there (GDPR: nothing from third parties).
 * Pure and browser-safe.
 */

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isOwnOrigin(url: string, siteUrl: string): boolean {
  const a = hostOf(url);
  const b = hostOf(siteUrl);
  return Boolean(a && b && a === b);
}

/** Absolute URL of `href` relative to `base`; null for data:, javascript: and broken URLs. */
export function absoluteUrl(href: string, base: string): string | null {
  const value = href.trim();
  if (!value || /^(data|javascript|blob|about):/i.test(value)) return null;
  try {
    const u = new URL(value, base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
