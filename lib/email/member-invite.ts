import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getAppBaseUrl, sendEmail } from "@/lib/email/mailer";
import { logEmailSend } from "@/lib/email/send-log";
import { renderOrgMemberInviteEmail } from "@/lib/email/templates/org-member-invite";
import { createServiceClient } from "@/lib/supabase/service";

export type MemberInviteEmailResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

export type MemberInviteLoginLinkResult =
  | { ok: true; link: string; isNewAccount: boolean }
  | { ok: false; reason: string };

function inboxRedirectUrl() {
  return `${getAppBaseUrl()}/dashboard/inbox`;
}

async function generateAuthLink(
  service: ReturnType<typeof createServiceClient>,
  email: string,
  type: "invite" | "magiclink",
) {
  return service.auth.admin.generateLink({
    type,
    email,
    options: { redirectTo: inboxRedirectUrl() },
  });
}

/**
 * Create a one-click login/invite link for the invitee.
 * Falls back invite → magiclink if the auth user already exists.
 */
export async function ensureMemberInviteLoginLink(
  email: string,
): Promise<MemberInviteLoginLinkResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, reason: "Keine E-Mail-Adresse" };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Service-Role fehlt",
    };
  }

  const { data: profile } = await service
    .from("profiles")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();

  let isNewAccount = !profile?.id;
  let linkType: "invite" | "magiclink" = isNewAccount ? "invite" : "magiclink";

  let { data: linkData, error: linkErr } = await generateAuthLink(
    service,
    normalized,
    linkType,
  );

  // Auth user may already exist even without a profiles row (or vice versa).
  if (linkErr && linkType === "invite") {
    console.warn(
      "[email] member invite link (invite) failed, trying magiclink:",
      linkErr.message,
    );
    isNewAccount = false;
    linkType = "magiclink";
    ({ data: linkData, error: linkErr } = await generateAuthLink(
      service,
      normalized,
      "magiclink",
    ));
  }

  if (linkErr) {
    console.warn("[email] member invite login link:", linkErr.message);
    return { ok: false, reason: `Anmeldelink fehlgeschlagen: ${linkErr.message}` };
  }

  const link = linkData?.properties?.action_link?.trim();
  if (!link) {
    return { ok: false, reason: "Anmeldelink leer (Supabase generateLink)." };
  }

  return { ok: true, link, isNewAccount };
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

export type SupabaseAuthInviteResult =
  | { ok: true; via: "invite" | "magiclink" }
  | { ok: false; reason: string };

function isAlreadyRegistered(message: string) {
  const m = message.toLowerCase();
  return m.includes("already been registered") || m.includes("already registered");
}

/**
 * Fallback delivery through Supabase's own auth mailer.
 * Used when the project SMTP relay refuses our branded mail — the invitee still
 * gets a working login link, just in Supabase's default layout.
 */
export async function sendSupabaseAuthInviteEmail(input: {
  email: string;
  organisationId: string;
  organisationName: string;
  role: string;
  isNewAccount: boolean;
  triggeredByUserId?: string | null;
}): Promise<SupabaseAuthInviteResult> {
  const to = input.email.trim().toLowerCase();
  if (!to) return { ok: false, reason: "Keine E-Mail-Adresse" };

  const logContext = {
    kind: "member_invite_supabase",
    to: [to],
    subject: `Einladung zu ${input.organisationName} (Supabase-Versand)`,
    metadata: {
      organisationName: input.organisationName,
      role: input.role,
      isNewAccount: input.isNewAccount,
    },
    triggeredByUserId: input.triggeredByUserId ?? null,
    organisationId: input.organisationId,
  };

  const fail = async (reason: string): Promise<SupabaseAuthInviteResult> => {
    await logEmailSend({ ...logContext, status: "failed", errorMessage: reason });
    return { ok: false, reason };
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return fail("Supabase-Konfiguration fehlt");

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Service-Role fehlt");
  }

  if (input.isNewAccount) {
    const { error } = await service.auth.admin.inviteUserByEmail(to, {
      redirectTo: inboxRedirectUrl(),
    });
    if (!error) {
      await logEmailSend({
        ...logContext,
        status: "sent",
        metadata: { ...logContext.metadata, via: "invite" },
      });
      return { ok: true, via: "invite" };
    }
    if (!isAlreadyRegistered(error.message)) {
      return fail(`Supabase-Einladung fehlgeschlagen: ${error.message}`);
    }
  }

  // Existing account: Supabase only mails a magic link through the public API.
  const anon = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await anon.auth.signInWithOtp({
    email: to,
    options: { shouldCreateUser: false, emailRedirectTo: inboxRedirectUrl() },
  });
  if (error) return fail(`Supabase-Magic-Link fehlgeschlagen: ${error.message}`);

  await logEmailSend({
    ...logContext,
    status: "sent",
    metadata: { ...logContext.metadata, via: "magiclink" },
  });
  return { ok: true, via: "magiclink" };
}

export function formatMemberInviteEmailStatus(
  result: MemberInviteEmailResult | null,
  linkError?: string | null,
): string {
  if (linkError) {
    return `Einladung gespeichert, aber E-Mail nicht gesendet (${linkError}).`;
  }
  if (!result) {
    return "Einladung gespeichert, aber E-Mail nicht gesendet (unbekannter Fehler).";
  }
  if (result.ok && !result.skipped) return "Einladungs-E-Mail wurde gesendet.";
  if (result.ok && result.skipped) {
    return `Einladung gespeichert, E-Mail übersprungen (${result.reason}). Prüfe SMTP unter Verwaltung → E-Mails.`;
  }
  if (!result.ok) {
    return `Einladung gespeichert, E-Mail fehlgeschlagen (${result.reason}).`;
  }
  return "Einladung gespeichert.";
}

export function memberInviteEmailSucceeded(
  result: MemberInviteEmailResult | null,
): boolean {
  return Boolean(result?.ok && !result.skipped);
}
