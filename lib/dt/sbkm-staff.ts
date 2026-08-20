export const SBKM_STAFF_EMAIL_DOMAIN = "sichtbarkeitsmeister.de";

/** Agency staff emails are platform admins (Verwaltung / SEO Modus). */
export function isSbkmStaffEmail(email: string | null | undefined): boolean {
  const value = email?.trim().toLowerCase() ?? "";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  return value.slice(at + 1) === SBKM_STAFF_EMAIL_DOMAIN;
}
