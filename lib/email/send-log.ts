import { createServiceClient } from "@/lib/supabase/service";

export type EmailLogStatus = "sent" | "skipped" | "failed";

export type EmailLogInput = {
  kind: string;
  status: EmailLogStatus;
  to: string[];
  subject: string;
  fromAddress?: string | null;
  errorMessage?: string | null;
  smtpMessageId?: string | null;
  metadata?: Record<string, unknown>;
  triggeredByUserId?: string | null;
  organisationId?: string | null;
};

export async function logEmailSend(input: EmailLogInput): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("email_send_logs").insert({
      kind: input.kind,
      status: input.status,
      to_addresses: input.to,
      subject: input.subject,
      from_address: input.fromAddress ?? null,
      error_message: input.errorMessage ?? null,
      smtp_message_id: input.smtpMessageId ?? null,
      metadata: input.metadata ?? {},
      triggered_by_user_id: input.triggeredByUserId ?? null,
      organisation_id: input.organisationId ?? null,
    });

    if (error) {
      console.warn("[email] send log insert failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn("[email] send log failed:", message);
  }
}

export function maskSmtpUser(value: string | undefined | null): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return `${trimmed.slice(0, 1)}***`;
  return `${trimmed.slice(0, 2)}***${trimmed.slice(at)}`;
}

export function getSmtpDiagnostics() {
  const host = process.env.SMTP_HOST?.trim() || null;
  const port = process.env.SMTP_PORT?.trim() || "587";
  const user = process.env.SMTP_USER?.trim() || null;
  const fromRaw = process.env.SMTP_FROM?.trim() || user;
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Sichtbarkeitsmeister";
  const from =
    fromRaw && !fromRaw.includes("<")
      ? `"${fromName}" <${fromRaw}>`
      : fromRaw;
  const hasPass = Boolean(
    process.env.SMTP_PASS?.trim() || process.env.SMTP_PASSWORD?.trim(),
  );

  return {
    configured: Boolean(host && user && hasPass),
    host,
    port,
    secure: process.env.SMTP_SECURE?.trim() || null,
    user: maskSmtpUser(user),
    from,
    hasPassword: hasPass,
  };
}
