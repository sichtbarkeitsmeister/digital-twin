import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import { logEmailSend } from "@/lib/email/send-log";
import { renderOrgMemberInviteEmail } from "@/lib/email/templates/org-member-invite";
import { createServiceClient } from "@/lib/supabase/service";

export type MemberInviteEmailResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

function inboxRedirectUrl() {
  return `${getAppBaseUrl()}/dashboard/inbox`;
}

export async function ensureMemberInviteLoginLink(
  email: string,
): Promise<{ link: string; isNewAccount: boolean } | null> {
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

  const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
    type: linkType,
    email: normalized,
    options: { redirectTo: inboxRedirectUrl() },
  });

  if (linkErr) {
    console.warn("[email] member invite login link:", linkErr.message);
    return null;
  }

  const link = linkData?.properties?.action_link?.trim();
  if (!link) return null;

  return { link, isNewAccount };
}

export async function sendOrgMemberInviteEmail(input: {
  email: string;
  organisationName: string;
  organisationId: string;
  role: string;
  link: string;
  isNewAccount: boolean;
  triggeredByUserId?: string | null;
}): Promise<MemberInviteEmailResult> {
  const to = input.email.trim().toLowerCase();
  const subject = `Einladung zu ${input.organisationName}`;
  const context = {
    kind: "member_invite",
    metadata: {
      organisationName: input.organisationName,
      role: input.role,
      isNewAccount: input.isNewAccount,
    },
    triggeredByUserId: input.triggeredByUserId ?? null,
    organisationId: input.organisationId,
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

  const html = renderOrgMemberInviteEmail({
    organisationName: input.organisationName,
    loginUrl: input.link,
    role: input.role,
    isNewAccount: input.isNewAccount,
  });
  const text = [
    `EINLADUNG zu ${input.organisationName} (DigitalTwin-Portal).`,
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
    console.warn("[email] member invite:", reason);
    return { ok: false, reason };
  }
}

export function formatMemberInviteEmailStatus(
  result: MemberInviteEmailResult | null,
): string {
  if (!result) {
    return "Einladung gespeichert, aber Anmeldelink konnte nicht erzeugt werden — E-Mail nicht gesendet.";
  }
  if (result.ok && !result.skipped) return "Einladungs-E-Mail wurde gesendet.";
  if (result.ok && result.skipped) {
    return `Einladung gespeichert, E-Mail übersprungen (${result.reason}).`;
  }
  if (!result.ok) {
    return `Einladung gespeichert, E-Mail fehlgeschlagen (${result.reason}).`;
  }
  return "Einladung gespeichert.";
}
