import { randomBytes } from "crypto";

import { getAppBaseUrl } from "@/lib/email/mailer";

export const LEADINFO_PROVIDER = "leadinfo" as const;

export const MAX_INTEGRATION_BODY_BYTES = 1024 * 1024;

export function generateWebhookToken() {
  return randomBytes(32).toString("base64url");
}

export function buildLeadinfoWebhookUrl(token: string) {
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/api/integrations/leadinfo/webhook/${token}`;
}

export function truncateBody(raw: string, maxBytes = MAX_INTEGRATION_BODY_BYTES) {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes <= maxBytes) {
    return raw;
  }

  return Buffer.from(raw, "utf8").subarray(0, maxBytes).toString("utf8");
}

export function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

export function extractSignatureHeader(headers: Record<string, string>) {
  return (
    headers["x-leadinfo-signature"] ??
    headers["x-signature"] ??
    headers["x-hub-signature-256"] ??
    null
  );
}

export function extractSourceIp(headers: Record<string, string>) {
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return headers["x-real-ip"] ?? null;
}

export function queryParamsToRecord(url: URL) {
  const record: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function topLevelBodyKeys(bodyJson: unknown) {
  if (!bodyJson || typeof bodyJson !== "object" || Array.isArray(bodyJson)) {
    return [];
  }
  return Object.keys(bodyJson as Record<string, unknown>).slice(0, 12);
}

export function previewBody(bodyRaw: string | null, bodyJson: unknown, max = 160) {
  if (bodyJson != null) {
    try {
      const text = JSON.stringify(bodyJson);
      return text.length <= max ? text : `${text.slice(0, max)}…`;
    } catch {
      // fall through
    }
  }

  if (!bodyRaw) return "—";
  return bodyRaw.length <= max ? bodyRaw : `${bodyRaw.slice(0, max)}…`;
}
