import assert from "node:assert/strict";

import {
  asEmailOtpType,
  loginLinkBaseUrl,
  loginUrlFromGenerateLink,
  magicLinkConfirmUrl,
  sanitizeNextPath,
} from "../lib/auth/login-link";
import { renderStaffMagicLinkEmail } from "../lib/email/templates/staff-magic-link";

assert.equal(sanitizeNextPath("/dashboard"), "/dashboard");
assert.equal(sanitizeNextPath("/dashboard/inbox"), "/dashboard/inbox");
assert.equal(sanitizeNextPath("https://evil.example/phish"), "/dashboard");
assert.equal(sanitizeNextPath("//evil.example"), "/dashboard");
assert.equal(sanitizeNextPath("dashboard"), "/dashboard");
assert.equal(sanitizeNextPath("/\\tevil"), "/dashboard");
assert.equal(sanitizeNextPath(null, "/"), "/");
assert.equal(sanitizeNextPath("", "/protected"), "/protected");

assert.equal(asEmailOtpType("magiclink"), "magiclink");
assert.equal(asEmailOtpType("invite"), "invite");
assert.equal(asEmailOtpType("email"), "email");
assert.equal(asEmailOtpType("nope"), "magiclink");

const url = magicLinkConfirmUrl("https://www.digital-twin-sbkm.de/", {
  tokenHash: "abc123",
  type: "magiclink",
  next: "/dashboard",
});
assert.equal(
  url,
  "https://www.digital-twin-sbkm.de/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fdashboard",
);

const fromGenerate = loginUrlFromGenerateLink(
  "https://www.digital-twin-sbkm.de",
  {
    hashed_token: "tok_staff",
    action_link: "https://xxxx.supabase.co/auth/v1/verify?token=implicit&type=magiclink",
    verification_type: "magiclink",
  },
  { next: "/dashboard" },
);
assert.match(fromGenerate ?? "", /token_hash=tok_staff/);
assert.doesNotMatch(fromGenerate ?? "", /supabase\.co/);

assert.equal(
  loginUrlFromGenerateLink("https://www.digital-twin-sbkm.de", {
    action_link: "https://xxxx.supabase.co/auth/v1/verify?token=implicit",
  }),
  null,
);

assert.equal(
  loginLinkBaseUrl("https://www.digital-twin-sbkm.de/auth/login", "https://fallback.example"),
  "https://www.digital-twin-sbkm.de",
);
assert.equal(loginLinkBaseUrl("not-a-url", "https://fallback.example/"), "https://fallback.example");
assert.equal(loginLinkBaseUrl("javascript:alert(1)", "https://fallback.example"), "https://fallback.example");

const html = renderStaffMagicLinkEmail({
  loginUrl: "https://www.digital-twin-sbkm.de/auth/confirm?token_hash=tok&type=magiclink&next=%2Fdashboard",
});
assert.match(html, /token_hash=tok/);
assert.match(html, /Jetzt anmelden/);

console.log("login-link: all ok");
