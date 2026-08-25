import nodemailer from "nodemailer";

import { logEmailSend } from "@/lib/email/send-log";

function boolFromEnv(v: string | undefined, fallback: boolean) {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return fallback;
}

/**
 * Trim env values and strip accidental wrapping quotes from Vercel paste
 * (`"secret"` / `'secret'`), which otherwise cause mailcow 535 auth failures.
 */
export function sanitizeSmtpSecret(value: string | undefined | null): string {
  if (value == null) return "";
  let s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // Vercel / shells sometimes keep a trailing newline in secrets.
  return s.replace(/\r?\n/g, "");
}

export type EmailSendContext = {
  kind?: string;
  metadata?: Record<string, unknown>;
  triggeredByUserId?: string | null;
  organisationId?: string | null;
};

export type EmailPayload = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  context?: EmailSendContext;
};

export type SmtpRuntimeConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  pass: string;
};

let cachedTransport: nodemailer.Transporter | null = null;
let cachedAuthUser: string | null = null;
let cachedConfigKey: string | null = null;

export function readSmtpRuntimeConfig(): SmtpRuntimeConfig {
  const host = sanitizeSmtpSecret(process.env.SMTP_HOST);
  const port = Number.parseInt(
    sanitizeSmtpSecret(process.env.SMTP_PORT) || "587",
    10,
  );
  const secure = boolFromEnv(process.env.SMTP_SECURE, port === 465);
  const user = sanitizeSmtpSecret(process.env.SMTP_USER).toLowerCase();
  // Prefer SMTP_PASS; SMTP_PASSWORD is an alias used in some deploys.
  const pass = sanitizeSmtpSecret(
    process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
  );

  if (!host) throw new Error("Missing SMTP_HOST");
  if (!Number.isFinite(port)) throw new Error("Invalid SMTP_PORT");
  if (!user) throw new Error("Missing SMTP_USER");
  if (!pass) throw new Error("Missing SMTP_PASS (or SMTP_PASSWORD)");

  return {
    host,
    port,
    secure,
    // Port 587 expects STARTTLS; without this some relays fail oddly.
    requireTls: !secure && port === 587,
    user,
    pass,
  };
}

function getTransport() {
  const cfg = readSmtpRuntimeConfig();
  const configKey = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.pass.length}`;
  if (cachedTransport && cachedConfigKey === configKey) return cachedTransport;

  cachedAuthUser = cfg.user;
  cachedConfigKey = configKey;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTls,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    // Explicit LOGIN helps some mailcow / Postfix setups.
    authMethod: "LOGIN",
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });

  return cachedTransport;
}

const DEFAULT_FROM_NAME = "Sichtbarkeitsmeister";

/**
 * Visible From header. Defaults to `Sichtbarkeitsmeister <address>`.
 * - SMTP_FROM may be a bare address or already `Name <addr>`
 * - SMTP_FROM_NAME overrides the display name when SMTP_FROM has no name
 */
export function getFromAddress() {
  const raw = sanitizeSmtpSecret(
    process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@example.com",
  );
  if (!raw) return `${DEFAULT_FROM_NAME} <no-reply@example.com>`;

  // Already a formatted "Name <email>" header — keep as-is.
  if (/^[^<]+<[^>]+>$/.test(raw) || raw.includes("<")) {
    return raw;
  }

  const name =
    sanitizeSmtpSecret(process.env.SMTP_FROM_NAME) || DEFAULT_FROM_NAME;
  // Unquoted display name — some SMTP relays reject/"soft-fail" quoted From headers.
  const safeName = name.replace(/[<>\r\n"]/g, "").trim() || DEFAULT_FROM_NAME;
  return `${safeName} <${raw}>`;
}

export function getAppBaseUrl() {
  const explicit = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (vercel) return vercel.replace(/\/+$/, "");

  return "http://localhost:3000";
}

export function parseEmailList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,\n;]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatSmtpFailureHint(rawMessage: string): string {
  const msg = rawMessage.trim();
  if (/535|authentication failed|invalid login/i.test(msg)) {
    return (
      `${msg} — SMTP-Login abgelehnt. Prüfe: ` +
      `SMTP_USER = volle Adresse (z. B. seo@…), ` +
      `SMTP_PASS ohne Anführungszeichen, ` +
      `Environment = Production + Redeploy, ` +
      `in mailcow für dieses Postfach „SMTP erlaubt“.`
    );
  }
  return msg;
}

/** Probe auth without sending mail — used by admin test tooling. */
export async function verifySmtpConnection(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  try {
    const transport = getTransport();
    await transport.verify();
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "SMTP-Verbindung fehlgeschlagen";
    return { ok: false, reason: formatSmtpFailureHint(reason) };
  }
}

export async function sendEmail(payload: EmailPayload) {
  const from = getFromAddress();
  const to = Array.from(new Set(payload.to.map((x) => x.trim()).filter(Boolean)));
  const kind = payload.context?.kind ?? "generic";
  const logBase = {
    kind,
    to,
    subject: payload.subject,
    fromAddress: from,
    metadata: payload.context?.metadata,
    triggeredByUserId: payload.context?.triggeredByUserId ?? null,
    organisationId: payload.context?.organisationId ?? null,
  };

  if (to.length === 0) {
    await logEmailSend({
      ...logBase,
      status: "skipped",
      errorMessage: "Kein Empfänger",
    });
    return { ok: true as const, skipped: true as const };
  }

  let transport: nodemailer.Transporter;
  try {
    transport = getTransport();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "SMTP nicht konfiguriert";
    await logEmailSend({
      ...logBase,
      status: "failed",
      errorMessage: reason,
    });
    throw err;
  }

  try {
    const info = await transport.sendMail({
      from,
      // Some SMTP servers require the SMTP "MAIL FROM" to be owned by the authenticated user.
      // Keep the visible From header configurable, but default the envelope sender to SMTP_USER.
      envelope: cachedAuthUser ? { from: cachedAuthUser, to } : undefined,
      to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    await logEmailSend({
      ...logBase,
      status: "sent",
      smtpMessageId: typeof info.messageId === "string" ? info.messageId : null,
    });

    return { ok: true as const, skipped: false as const, messageId: info.messageId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen";
    const reason = formatSmtpFailureHint(raw);
    await logEmailSend({
      ...logBase,
      status: "failed",
      errorMessage: reason,
    });
    throw new Error(reason);
  }
}
