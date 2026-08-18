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

/** Parse Supabase "you can only request this after N seconds" rate limits. */
export function parseEmailRateLimitSeconds(message: string): number | null {
  const m = message.match(/after\s+(\d+)\s+seconds?/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatSupabaseInviteFailure(message: string): string {
  const wait = parseEmailRateLimitSeconds(message);
  if (wait != null) {
    return (
      `Supabase-Versand vorübergehend begrenzt — bitte in ca. ${wait} Sekunden erneut versuchen ` +
      `(oder den Anmeldelink unten kopieren).`
    );
  }
  if (/535|authentication failed|invalid login/i.test(message)) {
    return `SMTP-Login fehlgeschlagen (${message}).`;
  }
  return message;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fallback delivery through Supabase's own auth mailer.
 * Used when the project SMTP relay refuses our branded mail — the invitee still
 * gets a working login link, just in Supabase's default layout.
 */
export async function sendSupabaseAuthInviteEmail(input: {
  email: string;
  organisationId?: string | null;
  organisationName: string;
  role: string;
  isNewAccount: boolean;
  triggeredByUserId?: string | null;
  /** Defaults to member_invite_supabase (also used for owner welcome). */
  logKind?: string;
}): Promise<SupabaseAuthInviteResult> {
  const to = input.email.trim().toLowerCase();
  if (!to) return { ok: false, reason: "Keine E-Mail-Adresse" };

  const logKind = input.logKind?.trim() || "member_invite_supabase";
  const logContext = {
    kind: logKind,
    to: [to],
    subject: `Einladung zu ${input.organisationName} (Supabase-Versand)`,
    metadata: {
      organisationName: input.organisationName,
      role: input.role,
      isNewAccount: input.isNewAccount,
    },
    triggeredByUserId: input.triggeredByUserId ?? null,
    organisationId: input.organisationId ?? null,
  };

  const fail = async (reason: string): Promise<SupabaseAuthInviteResult> => {
    const friendly = formatSupabaseInviteFailure(reason);
    await logEmailSend({ ...logContext, status: "failed", errorMessage: friendly });
    return { ok: false, reason: friendly };
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

  const sendInvite = async () =>
    service.auth.admin.inviteUserByEmail(to, {
      redirectTo: inboxRedirectUrl(),
    });

  const sendMagicLink = async () => {
    const anon = createSupabaseClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return anon.auth.signInWithOtp({
      email: to,
      options: { shouldCreateUser: false, emailRedirectTo: inboxRedirectUrl() },
    });
  };

  /** One short automatic retry when Supabase rate-limits briefly. */
  async function withRateLimitRetry<T extends { error: { message: string } | null }>(
    run: () => Promise<T>,
  ): Promise<T> {
    let result = await run();
    if (!result.error) return result;
    const waitSec = parseEmailRateLimitSeconds(result.error.message);
    // Only wait for short limits — longer waits would blow the request timeout.
    if (waitSec == null || waitSec > 12) return result;
    const waitMs = waitSec * 1000 + 400;
    console.warn(`[email] supabase rate limit — waiting ${waitMs}ms then retry`);
    await sleep(waitMs);
    return run();
  }

  if (input.isNewAccount) {
    const { error } = await withRateLimitRetry(sendInvite);
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
  const { error } = await withRateLimitRetry(sendMagicLink);
  if (error) return fail(`Supabase-Magic-Link fehlgeschlagen: ${error.message}`);

  await logEmailSend({
    ...logContext,
    status: "sent",
    metadata: { ...logContext.metadata, via: "magiclink" },
  });
  return { ok: true, via: "magiclink" };
}

/**
 * @param showTechnicalReason SMTP/relay errors are only meaningful for platform
 * admins — customers just see that the mail did not go out.
 */
export function formatMemberInviteEmailStatus(
  result: MemberInviteEmailResult | null,
  linkError?: string | null,
  showTechnicalReason = true,
): string {
  const detail = (reason: string) => (showTechnicalReason ? ` (${reason})` : "");

  if (linkError) {
    return `Einladung gespeichert, aber E-Mail nicht gesendet${detail(linkError)}.`;
  }
  if (!result) {
    return "Einladung gespeichert, aber E-Mail nicht gesendet.";
  }
  if (result.ok && !result.skipped) return "Einladungs-E-Mail wurde gesendet.";
  if (result.ok && result.skipped) {
    return showTechnicalReason
      ? `Einladung gespeichert, E-Mail übersprungen (${result.reason}). Prüfe SMTP unter Verwaltung → E-Mails.`
      : "Einladung gespeichert, E-Mail wurde nicht versendet.";
  }
  if (!result.ok) {
    return `Einladung gespeichert, E-Mail fehlgeschlagen${detail(result.reason)}.`;
  }
  return "Einladung gespeichert.";
}

export function memberInviteEmailSucceeded(
  result: MemberInviteEmailResult | null,
): boolean {
  return Boolean(result?.ok && !result.skipped);
}
