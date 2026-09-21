/**
 * Customer onboarding helpers.
 * Run: npx tsx scripts/test-dt-onboarding.ts
 */
import assert from "node:assert/strict";

import { buildDtSystemPrompt } from "../lib/dt/prompts/build-system-prompt";
import {
  DT_ONBOARDING_CONTACTS,
  DT_ONBOARDING_MAX_COMPETITORS,
  DT_ONBOARDING_MEDIA_INTRO,
  DT_ONBOARDING_MEDIA_ITEMS,
  DT_ONBOARDING_SUPPORT_EMAIL,
  DT_ONBOARDING_SUPPORT_NOTE,
  EMPTY_ONBOARDING_RECORD,
  onboardingDashboardPath,
  onboardingPublicPath,
} from "../lib/dt/onboarding/copy";
import {
  normalizeOnboardingRecord,
  onboardingChecklist,
  onboardingFilledCount,
  onboardingRecordFromRow,
  validateOnboardingRecord,
} from "../lib/dt/onboarding/normalize";
import { formatOnboardingForPrompt } from "../lib/dt/onboarding/prompt";
import {
  generateOnboardingUploadPassword,
  generateOnboardingUploadToken,
  onboardingPasswordsMatch,
} from "../lib/dt/onboarding/secrets";
import { guessOnboardingMime } from "../lib/dt/onboarding/mime";
import { isDashboardOrgBarPath } from "../lib/dt/seo/dashboard-path";

assert.equal(DT_ONBOARDING_MEDIA_ITEMS.length, 6);
assert.match(DT_ONBOARDING_MEDIA_INTRO, /Bilder oder Videos/);
assert.equal(DT_ONBOARDING_CONTACTS.length, 5);
assert.ok(DT_ONBOARDING_CONTACTS.some((c) => c.email === "ap@sichtbarkeitsmeister.de"));
assert.ok(DT_ONBOARDING_CONTACTS.some((c) => c.name === "Tanja Krüger"));
assert.match(DT_ONBOARDING_SUPPORT_NOTE, /support@sichtbarkeitsmeister.de/);
assert.equal(DT_ONBOARDING_SUPPORT_EMAIL, "support@sichtbarkeitsmeister.de");

const token = generateOnboardingUploadToken();
assert.ok(token.length >= 16);
assert.equal(onboardingPublicPath(token), `/onboarding/upload/${encodeURIComponent(token)}`);
assert.equal(
  onboardingDashboardPath("11111111-1111-4111-8111-111111111111"),
  "/dashboard/onboarding?org=11111111-1111-4111-8111-111111111111",
);

const password = generateOnboardingUploadPassword();
assert.equal(password.length, 10);
assert.equal(onboardingPasswordsMatch(password, password), true);
assert.equal(onboardingPasswordsMatch("wrong", password), false);
assert.equal(onboardingPasswordsMatch("", password), false);

const tooMany = normalizeOnboardingRecord({
  competitors: ["A", "B", "C", "D", "E", "F", "G"],
  smtpProtocol: "tls",
  billingEmail: "  buchhaltung@firma.de ",
  hosterUser: " host ",
});
assert.equal(tooMany.competitors.length, DT_ONBOARDING_MAX_COMPETITORS);
assert.deepEqual(tooMany.competitors, ["A", "B", "C", "D", "E"]);
assert.equal(tooMany.smtpProtocol, "TLS");
assert.equal(tooMany.billingEmail, "buchhaltung@firma.de");
assert.equal(tooMany.hosterUser, "host");

assert.equal(validateOnboardingRecord(tooMany), null);
assert.match(
  validateOnboardingRecord(normalizeOnboardingRecord({ billingEmail: "not-an-email" })) ?? "",
  /E-Mail/,
);
assert.match(
  validateOnboardingRecord(normalizeOnboardingRecord({ smtpPort: "abc" })) ?? "",
  /SMTP-Port/,
);

const fromRow = onboardingRecordFromRow({
  upload_token: token,
  upload_password: "CloudPass1",
  hoster_user: "ftp-user",
  hoster_password: "secret-hoster",
  smtp_host: "mail.example.de",
  smtp_port: "587",
  smtp_protocol: "TLS",
  smtp_username: "form@example.de",
  smtp_password: "smtp-secret",
  cms_login_url: "https://example.de/wp-admin",
  cms_user: "admin",
  cms_password: "cms-secret",
  competitors: ["Konkurrent A", "Konkurrent B"],
  billing_email: "rechnung@example.de",
});

const checklist = onboardingChecklist(fromRow, 3);
assert.equal(checklist.mediaLink, true);
assert.equal(onboardingChecklist(fromRow, 0).mediaLink, false);
assert.equal(checklist.hoster, true);
assert.equal(checklist.smtp, true);
assert.equal(checklist.cms, true);
assert.equal(checklist.competitors, true);
assert.equal(checklist.billingEmail, true);
assert.equal(checklist.files, 3);
assert.equal(onboardingFilledCount(checklist).filled, 6);

const emptyChecklist = onboardingChecklist(EMPTY_ONBOARDING_RECORD, 0);
assert.equal(onboardingFilledCount(emptyChecklist).filled, 0);

const prompt = formatOnboardingForPrompt({
  record: fromRow,
  organisationId: "11111111-1111-4111-8111-111111111111",
  fileCount: 3,
  appBaseUrl: "https://www.digital-twin-sbkm.de",
});
assert.match(prompt, /support@sichtbarkeitsmeister.de/);
assert.match(prompt, /André Petermann/);
assert.match(prompt, /Konkurrent A/);
assert.match(prompt, /rechnung@example.de/);
assert.match(prompt, /dashboard\/onboarding/);
assert.match(prompt, /Bilder und Videos/);
assert.doesNotMatch(prompt, /onboarding\/upload/);
assert.doesNotMatch(prompt, /secret-hoster/);
assert.doesNotMatch(prompt, /smtp-secret/);
assert.doesNotMatch(prompt, /cms-secret/);
assert.doesNotMatch(prompt, /CloudPass1/);
assert.match(prompt, /Passwörter/);

const staffPrompt = buildDtSystemPrompt({
  agent: {
    name: "DigitalTwin",
    role: "Berater",
    prompt_template: "Du hilfst dem Kunden.",
    kind: "default",
  },
  org: { display_name: "Muster GmbH" },
  mode: "default",
  onboardingText: prompt,
});
assert.match(staffPrompt, /Onboarding/);
assert.doesNotMatch(staffPrompt, /cms-secret/);

const prospectPrompt = buildDtSystemPrompt({
  agent: {
    name: "Julia",
    role: "Interessentin",
    prompt_template: "Du bist Julia.",
    kind: "wunschkunde",
  },
  org: { display_name: "Muster GmbH" },
  mode: "default",
  onboardingText: prompt,
});
assert.doesNotMatch(prospectPrompt, /Onboarding-Seite/);
assert.doesNotMatch(prospectPrompt, /CloudPass1/);

assert.equal(guessOnboardingMime("logo.SVG", ""), "image/svg+xml");
assert.equal(guessOnboardingMime("film.mp4", "video/mp4"), "video/mp4");
assert.equal(guessOnboardingMime("notes.exe", "application/x-msdownload"), "");

assert.equal(isDashboardOrgBarPath("/dashboard/onboarding"), true);
assert.equal(isDashboardOrgBarPath("/dashboard/onboarding/"), true);
assert.equal(isDashboardOrgBarPath("/dashboard/organisations"), true);

console.log("dt-onboarding: ok");
