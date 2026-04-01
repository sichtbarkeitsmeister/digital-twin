import nodemailer from "nodemailer";

function boolFromEnv(v: string | undefined, fallback: boolean) {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return fallback;
}

export type EmailPayload = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
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

export function getFromAddress() {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@example.com";
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
  if (to.length === 0) return { ok: true as const, skipped: true as const };

  const transport = getTransport();
  await transport.sendMail({
    from,
    // Some SMTP servers require the SMTP "MAIL FROM" to be owned by the authenticated user.
    // Keep the visible From header configurable, but default the envelope sender to SMTP_USER.
    envelope: cachedAuthUser ? { from: cachedAuthUser, to } : undefined,
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { ok: true as const, skipped: false as const };
}

