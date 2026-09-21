import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 18;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 10;

export function generateOnboardingUploadToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function generateOnboardingUploadPassword(length = PASSWORD_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

/** Timing-safe compare; hashes first so unequal lengths do not leak. */
export function onboardingPasswordsMatch(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(String(provided ?? ""), "utf8").digest();
  const right = createHash("sha256").update(String(expected ?? ""), "utf8").digest();
  return timingSafeEqual(left, right);
}
