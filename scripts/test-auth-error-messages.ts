import assert from "node:assert/strict";

import { germanAuthErrorMessage } from "../lib/shared/auth-error-messages";

function testRateLimit() {
  // Exactly the message that blocked the login on 03.08.
  const text = germanAuthErrorMessage(new Error("email rate limit exceeded"));
  assert.match(text, /Zu viele Anmeldelinks/);
  assert.doesNotMatch(text, /rate limit/i);

  assert.match(
    germanAuthErrorMessage(new Error("over_email_send_rate_limit")),
    /Zu viele Anmeldelinks/,
  );
  console.log("rate limit: ok");
}

function testCooldownKeepsSeconds() {
  const text = germanAuthErrorMessage(
    new Error("For security purposes, you can only request this after 47 seconds."),
  );
  assert.match(text, /47 Sekunden/);
  console.log("cooldown: ok");
}

function testOtherCases() {
  assert.match(
    germanAuthErrorMessage(new Error("Signups not allowed for otp")),
    /noch keinen Zugang/,
  );
  assert.match(
    germanAuthErrorMessage(new Error("Unable to validate email address: invalid format")),
    /gültige E-Mail-Adresse/,
  );
  assert.match(germanAuthErrorMessage(new Error("Failed to fetch")), /Keine Verbindung/);
  console.log("other cases: ok");
}

function testFallbacks() {
  // Unknown errors stay visible instead of being swallowed.
  const unknown = germanAuthErrorMessage(new Error("Something very specific broke"));
  assert.match(unknown, /Something very specific broke/);
  assert.match(germanAuthErrorMessage(null), /Ein Fehler ist aufgetreten/);
  assert.match(germanAuthErrorMessage(new Error("   ")), /Ein Fehler ist aufgetreten/);
  console.log("fallbacks: ok");
}

testRateLimit();
testCooldownKeepsSeconds();
testOtherCases();
testFallbacks();
console.log("All auth error message tests passed.");
