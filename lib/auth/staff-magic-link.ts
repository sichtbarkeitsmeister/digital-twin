import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  ensureAdminProfile,
  ensureConfirmedAuthUser,
} from "@/lib/auth/ensure-auth-user";
import {
  loginLinkBaseUrl,
  loginUrlFromGenerateLink,
} from "@/lib/auth/login-link";
import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import { renderStaffMagicLinkEmail } from "@/lib/email/templates/staff-magic-link";
import { isSbkmStaffEmail } from "@/lib/dt/sbkm-staff";
import { createServiceClient } from "@/lib/supabase/service";

export type StaffMagicLinkResult = {
  ok: boolean;
  message: string;
};

async function generateStaffLoginUrl(
  service: ReturnType<typeof createServiceClient>,
  email: string,
  baseUrl: string,
): Promise<string | null> {
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    console.warn("[auth] staff generateLink:", error.message);
    return null;
  }
  return loginUrlFromGenerateLink(baseUrl, data.properties, {
    type: "magiclink",
    next: "/dashboard",
  });
}

async function sendSupabaseOtpFallback(email: string, emailRedirectTo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    return { ok: false as const, reason: "Supabase-Konfiguration fehlt" };
  }
  const anon = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo },
  });
  if (error) return { ok: false as const, reason: error.message };
  return { ok: true as const };
}

/**
 * Agency staff (@sichtbarkeitsmeister.de) get a confirmed admin account and a
 * hashed_token login mail. Client OTP + admin action_link both fail for this
 * case: missing user + disabled signups, or implicit-flow links vs PKCE.
 */
export async function sendStaffMagicLink(input: {
  email: string;
  origin?: string | null;
}): Promise<StaffMagicLinkResult> {
  const email = input.email.trim().toLowerCase();
  if (!isSbkmStaffEmail(email)) {
    return { ok: false, message: "Kein SBKM-Staff-Konto." };
  }

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Service-Role fehlt",
    };
  }

  const { userId } = await ensureConfirmedAuthUser(service, email);
  await ensureAdminProfile(service, userId, email);

  const baseUrl = loginLinkBaseUrl(input.origin, getAppBaseUrl());
  const loginUrl = await generateStaffLoginUrl(service, email, baseUrl);
  const emailRedirectTo = `${baseUrl}/auth/confirm?next=/dashboard`;

  if (loginUrl) {
    try {
      const html = renderStaffMagicLinkEmail({ loginUrl });
      await sendEmail({
        to: [email],
        subject: "Dein Anmeldelink für DigitalTwin",
        text: [
          "Hallo,",
          "",
          "hier ist dein Anmeldelink für DigitalTwin:",
          loginUrl,
          "",
          "Der Link gilt nur kurze Zeit und lässt sich einmal verwenden.",
        ].join("\n"),
        html,
        context: { kind: "staff_magic_link", metadata: { email } },
      });
      return {
        ok: true,
        message: "Anmeldelink wurde per E-Mail geschickt.",
      };
    } catch (err) {
      console.warn(
        "[auth] staff magic-link SMTP failed, trying Supabase OTP:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const fallback = await sendSupabaseOtpFallback(email, emailRedirectTo);
  if (fallback.ok) {
    return {
      ok: true,
      message: "Anmeldelink wurde per E-Mail geschickt.",
    };
  }

  return {
    ok: false,
    message:
      "Anmeldelink konnte nicht gesendet werden. Bitte in ein paar Minuten erneut versuchen oder den Link unter Verwaltung → Plattform-Team kopieren lassen.",
  };
}
