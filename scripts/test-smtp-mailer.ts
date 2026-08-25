import assert from "node:assert/strict";

import {
  formatSmtpFailureHint,
  sanitizeSmtpSecret,
} from "../lib/email/mailer";

assert.equal(sanitizeSmtpSecret('  "secret"  '), "secret");
assert.equal(sanitizeSmtpSecret("'secret'"), "secret");
assert.equal(sanitizeSmtpSecret("secret\n"), "secret");
assert.equal(sanitizeSmtpSecret("  seo@x.de "), "seo@x.de");

assert.match(
  formatSmtpFailureHint("Invalid login: 535 5.7.8 authentication failed"),
  /SMTP-Login abgelehnt/,
);
assert.match(
  formatSmtpFailureHint("Invalid login: 535 5.7.8 authentication failed"),
  /Anführungszeichen/,
);

console.log("smtp mailer sanitize tests: ok");
