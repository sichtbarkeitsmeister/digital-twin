export const SBKM_STAFF_EMAIL_DOMAIN = "sichtbarkeitsmeister.de";

/** Agency staff emails are platform admins (Verwaltung / SEO Modus). */
export function isSbkmStaffEmail(email: string | null | undefined): boolean {
  const value = email?.trim().toLowerCase() ?? "";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  return value.slice(at + 1) === SBKM_STAFF_EMAIL_DOMAIN;
}

/**
 * Onboarding is an agency working surface: staff must reach every customer org
 * even when the account was demoted to the customer UI.
 */
export function shouldListAllOnboardingOrganisations(input: {
  isPlatformAdmin: boolean;
  email?: string | null;
}): boolean {
  return Boolean(input.isPlatformAdmin) || isSbkmStaffEmail(input.email);
}
