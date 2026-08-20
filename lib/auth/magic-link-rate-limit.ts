/** Hourly cap for Auth magic-link / OTP emails (Supabase Auth rate limits). */
export const MAGIC_LINK_EMAILS_PER_HOUR = 12;

export type AuthEmailRateLimitPatch = {
  rate_limit_email_sent: number;
  rate_limit_otp: number;
};

export function authEmailRateLimitPatch(
  perHour: number = MAGIC_LINK_EMAILS_PER_HOUR,
): AuthEmailRateLimitPatch {
  const n = Math.floor(perHour);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("Magic-Link-Limit muss mindestens 1 pro Stunde sein.");
  }
  return {
    rate_limit_email_sent: n,
    rate_limit_otp: n,
  };
}

export function magicLinkHourlyLimitMessage(
  perHour: number = MAGIC_LINK_EMAILS_PER_HOUR,
): string {
  return (
    `Es wurden zu viele Anmeldelinks in kurzer Zeit angefordert. Bis zu ${perHour} Links ` +
    "pro Stunde sind möglich. Bitte später erneut versuchen — ein bereits verschickter " +
    "Link funktioniert weiterhin."
  );
}

export function supabaseProjectRefFromUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
