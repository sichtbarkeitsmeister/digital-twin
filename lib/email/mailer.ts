import nodemailer from "nodemailer";

import { logEmailSend } from "@/lib/email/send-log";

function boolFromEnv(v: string | undefined, fallback: boolean) {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return fallback;
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

let cachedTransport: nodemailer.Transporter | null = null;
let cachedAuthUser: string | null = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = boolFromEnv(process.env.SMTP_SECURE, port === 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD;

  if (!host) throw new Error("Missing SMTP_HOST");
  if (!Number.isFinite(port)) throw new Error("Invalid SMTP_PORT");
  if (!user) throw new Error("Missing SMTP_USER");
  if (!pass) throw new Error("Missing SMTP_PASS (or SMTP_PASSWORD)");

  cachedAuthUser = user;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
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
  const raw = (process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@example.com").trim();
  if (!raw) return `${DEFAULT_FROM_NAME} <no-reply@example.com>`;

  // Already a formatted "Name <email>" header — keep as-is.
  if (/^[^<]+<[^>]+>$/.test(raw) || raw.includes("<")) {
    return raw;
  }

  const name = (process.env.SMTP_FROM_NAME ?? DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME;
  // Escape quotes in display name for RFC 5322 safety.
  const safeName = name.replace(/["\\]/g, "");
  return `"${safeName}" <${raw}>`;
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
    const reason = err instanceof Error ? err.message : "E-Mail-Versand fehlgeschlagen";
    await logEmailSend({
      ...logBase,
      status: "failed",
      errorMessage: reason,
    });
    throw err;
  }
}

