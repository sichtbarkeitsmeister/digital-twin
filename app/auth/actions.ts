"use server";

import { translateAuthError } from "@/lib/auth/error-messages";
import { loginLinkBaseUrl } from "@/lib/auth/login-link";
import { sendStaffMagicLink } from "@/lib/auth/staff-magic-link";
import { isSbkmStaffEmail } from "@/lib/dt/sbkm-staff";
import { getAppBaseUrl } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";

export type MagicLinkActionResult = {
  ok: boolean;
  message: string;
};

export async function requestMagicLinkAction(
  emailRaw: string,
  origin?: string | null,
): Promise<MagicLinkActionResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Bitte gib eine gültige E-Mail-Adresse ein." };
  }

  if (isSbkmStaffEmail(email)) {
    try {
      return await sendStaffMagicLink({ email, origin });
    } catch (err) {
      console.warn("[auth] staff magic link:", err instanceof Error ? err.message : err);
      return {
        ok: false,
        message: "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
      };
    }
  }

  const supabase = await createClient();
  const baseUrl = loginLinkBaseUrl(origin, getAppBaseUrl());
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${baseUrl}/auth/confirm?next=/dashboard`,
    },
  });

  if (error) {
    return { ok: false, message: translateAuthError(error.message) };
  }

  return { ok: true, message: "Anmeldelink wurde per E-Mail geschickt." };
}
