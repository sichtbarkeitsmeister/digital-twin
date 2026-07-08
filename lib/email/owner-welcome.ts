import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
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

export async function ensureOwnerLoginLink(
  email: string,
): Promise<OwnerLoginLinkResult | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const service = createServiceClient();
  const { data: profile } = await service
    .from("profiles")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();

  const isNewAccount = !profile?.id;
  const linkType = isNewAccount ? "invite" : "magiclink";
  const redirectTo = ownerPortalRedirectUrl();

  const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
    type: linkType,
    email: normalized,
    options: { redirectTo },
  });

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
  const subject = `Willkommen als Inhaber von ${input.organisationName}`;
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
    `Du bist jetzt Inhaber von ${input.organisationName}.`,
    "",
    "Melde dich mit diesem Link an:",
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

export function formatOwnerWelcomeEmailStatus(
  result: OwnerWelcomeEmailResult | null,
  sendWelcome: boolean,
): string | null {
  if (!sendWelcome) return null;
  if (!result) return "Willkommens-E-Mail konnte nicht gesendet werden (Anmeldelink fehlgeschlagen).";
  if (result.ok && !result.skipped) return "Willkommens-E-Mail wurde gesendet.";
  if (result.ok && result.skipped) {
    return `Willkommens-E-Mail übersprungen (${result.reason}).`;
  }
  if (!result.ok) {
    return `Willkommens-E-Mail fehlgeschlagen (${result.reason}).`;
  }
  return null;
}
