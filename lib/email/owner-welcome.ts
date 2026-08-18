import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import {
  sendSupabaseAuthInviteEmail,
  type SupabaseAuthInviteResult,
} from "@/lib/email/member-invite";
import { logEmailSend } from "@/lib/email/send-log";
import { renderOrgOwnerWelcomeEmail } from "@/lib/email/templates/org-owner-welcome";
import { createServiceClient } from "@/lib/supabase/service";

export type OwnerLoginLinkResult = {
  link: string;
  isNewAccount: boolean;
};

export type OwnerWelcomeEmailResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

function ownerPortalRedirectUrl() {
  return `${getAppBaseUrl()}/`;
}

async function generateOwnerAuthLink(
  service: ReturnType<typeof createServiceClient>,
  email: string,
  type: "invite" | "magiclink",
) {
  return service.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo: ownerPortalRedirectUrl() },
  });
}

export async function ensureOwnerLoginLink(
  email: string,
): Promise<OwnerLoginLinkResult | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch (err) {
    console.warn(
      "[email] owner login link: service client unavailable:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const { data: profile } = await service
    .from("profiles")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();

  let isNewAccount = !profile?.id;
  let linkType: "invite" | "magiclink" = isNewAccount ? "invite" : "magiclink";

  let { data: linkData, error: linkErr } = await generateOwnerAuthLink(
    service,
    normalized,
    linkType,
  );

  // Auth user may already exist even without a profiles row (or vice versa).
  if (linkErr && linkType === "invite") {
    console.warn(
      "[email] owner invite link failed, trying magiclink:",
      linkErr.message,
    );
    isNewAccount = false;
    linkType = "magiclink";
    ({ data: linkData, error: linkErr } = await generateOwnerAuthLink(
      service,
      normalized,
      "magiclink",
    ));
  }

  if (linkErr) {
    console.warn("[email] owner login link:", linkErr.message);
    return null;
  }

  const link = linkData?.properties?.action_link?.trim();
  if (!link) return null;

  return { link, isNewAccount };
}

export async function sendOrgOwnerWelcomeEmail(input: {
  email: string;
  organisationName: string;
  link: string;
  isNewAccount: boolean;
  triggeredByUserId?: string | null;
  organisationId?: string | null;
}): Promise<OwnerWelcomeEmailResult> {
  const to = input.email.trim().toLowerCase();
  const subject = `Einladung: Du bist Inhaber von ${input.organisationName}`;
  const context = {
    kind: "owner_welcome",
    metadata: {
      organisationName: input.organisationName,
      isNewAccount: input.isNewAccount,
    },
    triggeredByUserId: input.triggeredByUserId ?? null,
    organisationId: input.organisationId ?? null,
  };

  if (!process.env.SMTP_HOST?.trim()) {
    await logEmailSend({
      kind: context.kind,
      status: "skipped",
      to: to ? [to] : [],
      subject,
      errorMessage: "SMTP nicht konfiguriert",
      metadata: context.metadata,
      triggeredByUserId: context.triggeredByUserId,
      organisationId: context.organisationId,
    });
    return { ok: true, skipped: true, reason: "SMTP nicht konfiguriert" };
  }

  if (!to) {
    await logEmailSend({
      kind: context.kind,
      status: "failed",
      to: [],
      subject,
      errorMessage: "Keine E-Mail-Adresse",
      metadata: context.metadata,
      triggeredByUserId: context.triggeredByUserId,
      organisationId: context.organisationId,
    });
    return { ok: false, reason: "Keine E-Mail-Adresse" };
  }

  const html = renderOrgOwnerWelcomeEmail({
    organisationName: input.organisationName,
    loginUrl: input.link,
    isNewAccount: input.isNewAccount,
  });
  const text = [
    `EINLADUNG: Du wurdest als Inhaber von ${input.organisationName} eingeladen.`,
    "",
    "Einladung annehmen:",
    input.link,
    "",
    "Der Link ist zeitlich begrenzt.",
  ].join("\n");

  try {
    const result = await sendEmail({
      to: [to],
      subject,
      text,
      html,
      context,
    });
    if (result.skipped) {
      return { ok: true, skipped: true, reason: "Kein Empfänger" };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen";
    console.warn("[email] owner welcome:", reason);
    return { ok: false, reason };
  }
}

export function ownerWelcomeEmailSucceeded(
  result: OwnerWelcomeEmailResult | null,
): boolean {
  return Boolean(result?.ok && !result.skipped);
}

/**
 * When branded SMTP fails/skips, deliver via Supabase auth mailer (same as
 * member invites). SMTP at mailcow has historically rejected auth — without
 * this fallback owner invites never arrive.
 */
export async function deliverOwnerWelcomeWithFallback(input: {
  email: string;
  organisationName: string;
  organisationId?: string | null;
  link: string | null;
  isNewAccount: boolean;
  triggeredByUserId?: string | null;
}): Promise<{
  branded: OwnerWelcomeEmailResult | null;
  fallback: SupabaseAuthInviteResult | null;
  emailSent: boolean;
  statusMessage: string;
}> {
  let branded: OwnerWelcomeEmailResult | null = null;
  if (input.link) {
    branded = await sendOrgOwnerWelcomeEmail({
      email: input.email,
      organisationName: input.organisationName,
      link: input.link,
      isNewAccount: input.isNewAccount,
      triggeredByUserId: input.triggeredByUserId,
      organisationId: input.organisationId,
    });
    if (ownerWelcomeEmailSucceeded(branded)) {
      return {
        branded,
        fallback: null,
        emailSent: true,
        statusMessage: "Einladungs-E-Mail wurde gesendet.",
      };
    }
  }

  const fallback = await sendSupabaseAuthInviteEmail({
    email: input.email,
    organisationId: input.organisationId,
    organisationName: input.organisationName,
    role: "owner",
    isNewAccount: input.isNewAccount,
    triggeredByUserId: input.triggeredByUserId,
    logKind: "owner_welcome_supabase",
  });

  if (fallback.ok) {
    const brandedNote = branded
      ? formatOwnerWelcomeEmailStatus(branded, true)
      : "Einladungs-E-Mail konnte nicht über SMTP gesendet werden.";
    return {
      branded,
      fallback,
      emailSent: true,
      statusMessage:
        `${brandedNote ?? "SMTP-Versand fehlgeschlagen."} ` +
        "Ersatzweise wurde ein Anmeldelink über Supabase gesendet " +
        "(Absender: noreply@mail.app.supabase.io) — Spam-Ordner prüfen.",
    };
  }

  return {
    branded,
    fallback,
    emailSent: false,
    statusMessage:
      formatOwnerWelcomeEmailStatus(branded, true) ??
      `Einladungs-E-Mail fehlgeschlagen (${fallback.reason}).`,
  };
}

export function formatOwnerWelcomeEmailStatus(
  result: OwnerWelcomeEmailResult | null,
  sendWelcome: boolean,
): string | null {
  if (!sendWelcome) return null;
  if (!result) return "Einladungs-E-Mail konnte nicht gesendet werden (Anmeldelink fehlgeschlagen).";
  if (result.ok && !result.skipped) return "Einladungs-E-Mail wurde gesendet.";
  if (result.ok && result.skipped) {
    return `Einladungs-E-Mail übersprungen (${result.reason}).`;
  }
  if (!result.ok) {
    return `Einladungs-E-Mail fehlgeschlagen (${result.reason}).`;
  }
  return null;
}
