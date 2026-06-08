/** Primary Google account — n8n If nodes compare ga4_account / gsc_account to this value. */
export const PRIMARY_GOOGLE_ACCOUNT = "ads@sichtbarkeitsmeister.de";

/** Value passed to n8n for If routing (empty when unset — legacy uses ads2@ branch). */
export function googleAccountForN8nRouting(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function isPrimaryGoogleAccount(value: string | null | undefined): boolean {
  return googleAccountForN8nRouting(value) === PRIMARY_GOOGLE_ACCOUNT;
}
