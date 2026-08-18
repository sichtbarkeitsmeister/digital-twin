import assert from "node:assert/strict";

import {
  formatOwnerWelcomeEmailStatus,
  ownerWelcomeEmailSucceeded,
} from "../lib/email/owner-welcome";
import {
  formatMemberInviteEmailStatus,
  formatSupabaseInviteFailure,
  memberInviteEmailSucceeded,
  parseEmailRateLimitSeconds,
} from "../lib/email/member-invite";

assert.equal(
  ownerWelcomeEmailSucceeded({ ok: true, skipped: false }),
  true,
);
assert.equal(
  ownerWelcomeEmailSucceeded({ ok: true, skipped: true, reason: "SMTP nicht konfiguriert" }),
  false,
);
assert.equal(
  ownerWelcomeEmailSucceeded({ ok: false, reason: "relay refused" }),
  false,
);

assert.match(
  formatOwnerWelcomeEmailStatus(
    { ok: true, skipped: true, reason: "SMTP nicht konfiguriert" },
    true,
  ) ?? "",
  /SMTP nicht konfiguriert/,
);

assert.equal(
  memberInviteEmailSucceeded({ ok: true, skipped: false }),
  true,
);
assert.match(
  formatMemberInviteEmailStatus(
    { ok: false, reason: "535 authentication failed" },
    null,
    true,
  ),
  /535 authentication failed/,
);

assert.equal(
  parseEmailRateLimitSeconds(
    "For security purposes, you can only request this after 58 seconds.",
  ),
  58,
);
assert.equal(parseEmailRateLimitSeconds("other error"), null);
assert.match(
  formatSupabaseInviteFailure(
    "Supabase-Magic-Link fehlgeschlagen: For security purposes, you can only request this after 58 seconds.",
  ),
  /ca\. 58 Sekunden/,
);

console.log("owner-welcome / invite email status tests: ok");
