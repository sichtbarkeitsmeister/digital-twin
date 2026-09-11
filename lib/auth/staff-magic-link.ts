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
import { isSbkmStaffEmail, staffMagicLinkRecipients } from "@/lib/dt/sbkm-staff";
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

/**
 * Agency staff (@sichtbarkeitsmeister.de) get a confirmed admin account and a
 * hashed_token login mail. Client OTP + admin action_link both fail for this
 * case: missing user + disabled signups, or implicit-flow links vs PKCE.
 *
 * A copy goes to the owner inbox so the working link can be forwarded if the
 * colleague's mail never arrives (the previous failure mode).
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
  if (!loginUrl) {
    return {
      ok: false,
      message:
        "Anmeldelink konnte nicht erzeugt werden. Bitte unter Verwaltung → Plattform-Team " +
        "„Admin-Ansicht geben“ nutzen und den angezeigten Link weitergeben.",
    };
  }

  const recipients = staffMagicLinkRecipients(email);
  let sent = 0;
  const errors: string[] = [];

  for (const to of recipients) {
    const isCopy = to !== email;
    try {
      await sendEmail({
        to: [to],
        subject: isCopy
          ? `Anmeldelink für ${email} (bitte weiterleiten)`
          : "Dein Anmeldelink für DigitalTwin",
        text: isCopy
          ? [
              `Anmeldelink für ${email}:`,
              loginUrl,
              "",
              "Bitte diesen Link weiterleiten, falls die eigene Mail nicht ankommt.",
              "Alte Links aus früheren Versuchen funktionieren nicht.",
            ].join("\n")
          : [
              "Hallo,",
              "",
              "hier ist dein Anmeldelink für DigitalTwin:",
              loginUrl,
              "",
              "Der Link gilt nur kurze Zeit und lässt sich einmal verwenden.",
            ].join("\n"),
        html: renderStaffMagicLinkEmail({
          loginUrl,
          forColleague: isCopy ? email : null,
        }),
        context: {
          kind: isCopy ? "staff_magic_link_copy" : "staff_magic_link",
          metadata: { email, to },
        },
      });
      sent += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen";
      errors.push(`${to}: ${reason}`);
      console.warn("[auth] staff magic-link mail failed:", to, reason);
    }
  }

  if (sent > 0) {
    return {
      ok: true,
      message:
        sent === 1
          ? "Anmeldelink wurde per E-Mail geschickt."
          : "Anmeldelink wurde per E-Mail geschickt — eine Kopie liegt im Postfach von mail@sichtbarkeitsmeister.de zum Weiterleiten.",
    };
  }

  return {
    ok: false,
    message:
      "E-Mail-Versand fehlgeschlagen. Das Konto ist angelegt: unter Verwaltung → Plattform-Team " +
      "den Anmeldelink kopieren und per WhatsApp/Slack weitergeben." +
      (errors[0] ? ` (${errors[0]})` : ""),
  };
}
