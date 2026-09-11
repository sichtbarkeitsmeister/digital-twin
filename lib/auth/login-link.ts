import type { EmailOtpType } from "@supabase/supabase-js";

const EMAIL_OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export type GenerateLinkProperties = {
  hashed_token?: string | null;
  action_link?: string | null;
  verification_type?: string | null;
};

/** Only same-origin relative paths. Blocks protocol-relative and open redirects. */
export function sanitizeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  const value = (next ?? "").trim() || fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\") || value.includes("://")) return fallback;
  return value;
}

export function asEmailOtpType(
  value: string | null | undefined,
  fallback: EmailOtpType = "magiclink",
): EmailOtpType {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (EMAIL_OTP_TYPES.has(normalized)) return normalized as EmailOtpType;
  return fallback;
}

/**
 * App-hosted confirm URL. `action_link` from admin generateLink is implicit-flow
 * and does not work with @supabase/ssr PKCE — hashed_token + verifyOtp does.
 */
export function magicLinkConfirmUrl(
  baseUrl: string,
  opts: {
    tokenHash: string;
    type?: EmailOtpType;
    next?: string;
  },
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    token_hash: opts.tokenHash,
    type: opts.type ?? "magiclink",
    next: sanitizeNextPath(opts.next),
  });
  return `${base}/auth/confirm?${params.toString()}`;
}

export function loginUrlFromGenerateLink(
  baseUrl: string,
  properties: GenerateLinkProperties | null | undefined,
  opts?: { type?: EmailOtpType; next?: string },
): string | null {
  const token = properties?.hashed_token?.trim();
  if (!token) return null;
  return magicLinkConfirmUrl(baseUrl, {
    tokenHash: token,
    type: asEmailOtpType(opts?.type ?? properties?.verification_type),
    next: opts?.next,
  });
}

/** Accept http(s) origins from the login page; otherwise fall back to APP_BASE_URL. */
export function loginLinkBaseUrl(origin: string | null | undefined, fallback: string): string {
  const raw = origin?.trim() ?? "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback.replace(/\/+$/, "");
    return url.origin;
  } catch {
    return fallback.replace(/\/+$/, "");
  }
}
