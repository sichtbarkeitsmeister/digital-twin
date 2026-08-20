import assert from "node:assert/strict";

import { translateAuthError } from "../lib/auth/error-messages";
import {
  MAGIC_LINK_EMAILS_PER_HOUR,
  authEmailRateLimitPatch,
  magicLinkHourlyLimitMessage,
  supabaseProjectRefFromUrl,
} from "../lib/auth/magic-link-rate-limit";

function testKnownCases() {
  assert.match(
    translateAuthError("For security purposes, you can only request this after 47 seconds."),
    /47 Sekunden/,
  );
  assert.match(translateAuthError("email rate limit exceeded"), /zu viele Anmeldelinks/i);
  assert.match(translateAuthError("email rate limit exceeded"), /12 Links/);
  assert.match(translateAuthError("Signups not allowed for otp"), /noch keinen Zugang/);
  assert.match(translateAuthError("Failed to fetch"), /Keine Verbindung/);
  assert.match(
    translateAuthError("Email link is invalid or has expired"),
    /abgelaufen oder wurde bereits verwendet/,
  );
  assert.match(translateAuthError("Unable to validate email address: invalid format"), /abgelaufen|gültige E-Mail/);
  console.log("known auth errors: ok");
}

function testFallbacks() {
  const generic = "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";
  assert.equal(translateAuthError(null), generic);
  assert.equal(translateAuthError("   "), generic);
  assert.equal(translateAuthError("some brand new supabase wording"), generic);
  console.log("auth error fallbacks: ok");
}

testKnownCases();
testFallbacks();

assert.equal(MAGIC_LINK_EMAILS_PER_HOUR, 12);
assert.deepEqual(authEmailRateLimitPatch(), {
  rate_limit_email_sent: 12,
  rate_limit_otp: 12,
});
assert.match(magicLinkHourlyLimitMessage(), /12 Links pro Stunde/);
assert.equal(
  supabaseProjectRefFromUrl("https://abcdefghij.supabase.co"),
  "abcdefghij",
);
assert.equal(supabaseProjectRefFromUrl("not-a-url"), null);

console.log("All auth error message tests passed.");
