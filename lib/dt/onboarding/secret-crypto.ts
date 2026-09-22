import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc.v1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = "aes-256-gcm";

export const ONBOARDING_SECRET_PREFIX = PREFIX;

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function uniqueSecrets(): string[] {
  const dedicated = process.env.DT_ONBOARDING_SECRETS_KEY?.trim();
  const fallback = process.env.DT_INTERNAL_WEBHOOK_SECRET?.trim();
  return [...new Set([dedicated, fallback].filter((value): value is string => Boolean(value)))];
}

/** Dedicated key first; webhook secret is a temporary fallback so production encrypts immediately. */
export function resolveOnboardingSecretsKey(): Buffer | null {
  const first = uniqueSecrets()[0];
  return first ? keyFromSecret(first) : null;
}

function resolveOnboardingSecretsKeys(): Buffer[] {
  return uniqueSecrets().map(keyFromSecret);
}

export function isOnboardingSecretCiphertext(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptOnboardingSecret(
  plain: string,
  key = resolveOnboardingSecretsKey(),
): string {
  const trimmed = String(plain ?? "").trim();
  if (!trimmed) return "";
  if (isOnboardingSecretCiphertext(trimmed)) return trimmed;
  if (!key) return trimmed;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptOnboardingSecret(
  value: string,
  key?: Buffer | null,
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (!isOnboardingSecretCiphertext(trimmed)) return trimmed;
  const keys = key ? [key] : resolveOnboardingSecretsKeys();
  if (keys.length === 0) {
    console.error("[onboarding] decrypt skipped: missing DT_ONBOARDING_SECRETS_KEY");
    return "";
  }
  for (const candidate of keys) {
    try {
      const raw = Buffer.from(trimmed.slice(PREFIX.length), "base64url");
      if (raw.length < IV_BYTES + TAG_BYTES + 1) return "";
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const data = raw.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(ALGO, candidate, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      // try the next key
    }
  }
  console.error("[onboarding] decrypt failed");
  return "";
}

export function encryptOnboardingRowSecrets<
  T extends {
    upload_password?: string | null;
    hoster_password?: string | null;
    smtp_password?: string | null;
    cms_password?: string | null;
  },
>(row: T, key = resolveOnboardingSecretsKey()): T {
  return {
    ...row,
    upload_password: row.upload_password
      ? encryptOnboardingSecret(row.upload_password, key)
      : row.upload_password ?? null,
    hoster_password: row.hoster_password
      ? encryptOnboardingSecret(row.hoster_password, key)
      : row.hoster_password ?? null,
    smtp_password: row.smtp_password
      ? encryptOnboardingSecret(row.smtp_password, key)
      : row.smtp_password ?? null,
    cms_password: row.cms_password
      ? encryptOnboardingSecret(row.cms_password, key)
      : row.cms_password ?? null,
  };
}

export function decryptOnboardingRecordSecrets<
  T extends {
    uploadPassword: string;
    hosterPassword: string;
    smtpPassword: string;
    cmsPassword: string;
  },
>(record: T, key?: Buffer): T {
  return {
    ...record,
    uploadPassword: decryptOnboardingSecret(record.uploadPassword, key),
    hosterPassword: decryptOnboardingSecret(record.hosterPassword, key),
    smtpPassword: decryptOnboardingSecret(record.smtpPassword, key),
    cmsPassword: decryptOnboardingSecret(record.cmsPassword, key),
  };
}
