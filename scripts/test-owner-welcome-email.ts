import assert from "node:assert/strict";

import {
  formatOwnerWelcomeEmailStatus,
  ownerWelcomeEmailSucceeded,
} from "../lib/email/owner-welcome";
import {
  formatMemberInviteEmailStatus,
  memberInviteEmailSucceeded,
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

console.log("owner-welcome / invite email status tests: ok");
