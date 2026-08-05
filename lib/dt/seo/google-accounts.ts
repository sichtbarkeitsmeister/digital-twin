/** Primary Google account — n8n If nodes compare ga4_account / gsc_account to this value. */
export const PRIMARY_GOOGLE_ACCOUNT = "ads@sichtbarkeitsmeister.de";

/** Secondary Google account used by n8n when ga4/gsc account is not the primary. */
export const SECONDARY_GOOGLE_ACCOUNT = "ads2@sichtbarkeitsmeister.de";

/** Selectable SBKM Google accounts for GA4 / GSC OAuth routing in n8n. */
export const GOOGLE_ACCOUNT_OPTIONS = [
  PRIMARY_GOOGLE_ACCOUNT,
  SECONDARY_GOOGLE_ACCOUNT,
] as const;

/** Value passed to n8n for If routing (empty when unset — legacy uses ads2@ branch). */
export function googleAccountForN8nRouting(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function isPrimaryGoogleAccount(value: string | null | undefined): boolean {
  return googleAccountForN8nRouting(value) === PRIMARY_GOOGLE_ACCOUNT;
}

/** Normalize UI/API input to a stored account value (null when empty). */
export function normalizeGoogleAccount(value: string | null | undefined): string | null {
  const trimmed = googleAccountForN8nRouting(value);
  return trimmed || null;
}
