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
  DT_ONBOARDING_PHONE_NOTE,
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
assert.equal(DT_ONBOARDING_CONTACTS.length, 6);
assert.equal(DT_ONBOARDING_CONTACTS[0]?.name, "Tanja Krüger");
assert.match(DT_ONBOARDING_CONTACTS[0]?.role ?? "", /DigitalTwin/);
assert.match(DT_ONBOARDING_CONTACTS[0]?.shortRole ?? "", /GEO/);
assert.ok(DT_ONBOARDING_CONTACTS.some((c) => c.email === "ap@sichtbarkeitsmeister.de"));
assert.ok(DT_ONBOARDING_CONTACTS.some((c) => c.name === "Tami Sulakadze"));
assert.ok(DT_ONBOARDING_CONTACTS.some((c) => c.email === "support@sichtbarkeitsmeister.de"));
assert.match(DT_ONBOARDING_SUPPORT_NOTE, /support@sichtbarkeitsmeister.de/);
assert.match(DT_ONBOARDING_SUPPORT_NOTE, /Urlaub/);
assert.doesNotMatch(DT_ONBOARDING_SUPPORT_NOTE, /alle E-Mails an diese Adresse/);
assert.equal(DT_ONBOARDING_SUPPORT_EMAIL, "support@sichtbarkeitsmeister.de");

const addressingReader =
  /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|sie|ihnen|ihre|ihren|ihrem|ihrer)\b/i;
for (const contact of DT_ONBOARDING_CONTACTS) {
  assert.equal(addressingReader.test(contact.role), false, contact.name);
}
assert.equal(addressingReader.test(DT_ONBOARDING_SUPPORT_NOTE), false);
assert.equal(addressingReader.test(DT_ONBOARDING_PHONE_NOTE), false);
assert.equal(addressingReader.test(DT_ONBOARDING_MEDIA_INTRO), false);
for (const item of DT_ONBOARDING_MEDIA_ITEMS) {
  assert.equal(addressingReader.test(item), false, item);
}

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

const withContacts = normalizeOnboardingRecord({
  customerContacts: [
    { name: "  Lars Diehl ", role: "GF", email: "lars@example.de", phone: "0123" },
    { name: "", role: "", email: "", phone: "" },
  ],
  additionalInfo: "  Bitte Logo in SVG  ",
});
assert.equal(withContacts.customerContacts[0]?.name, "Lars Diehl");
assert.equal(withContacts.customerContacts[0]?.email, "lars@example.de");
assert.equal(withContacts.customerContacts.length, 5);
assert.equal(withContacts.additionalInfo, "Bitte Logo in SVG");
assert.equal(
  onboardingChecklist(withContacts, 0).customerContacts,
  true,
);
assert.match(
  validateOnboardingRecord(
    normalizeOnboardingRecord({
      customerContacts: [{ name: "A", role: "", email: "not-an-email", phone: "" }],
    }),
  ) ?? "",
  /Ansprechpartner/,
);

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
  customer_contacts: [
    { name: "Lars Diehl", role: "Geschäftsführung", email: "lars@example.de", phone: "0211 123" },
  ],
  additional_info: "Logo folgt nächste Woche.",
});

const checklist = onboardingChecklist(fromRow, 3);
assert.equal(checklist.mediaLink, true);
assert.equal(onboardingChecklist(fromRow, 0).mediaLink, false);
assert.equal(checklist.hoster, true);
assert.equal(checklist.smtp, true);
assert.equal(checklist.cms, true);
assert.equal(checklist.competitors, true);
assert.equal(checklist.billingEmail, true);
assert.equal(checklist.customerContacts, true);
assert.equal(checklist.files, 3);
assert.equal(onboardingFilledCount(checklist).filled, 7);
assert.equal(onboardingFilledCount(checklist).total, 7);

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
assert.match(prompt, /Lars Diehl/);
assert.match(prompt, /Logo folgt nächste Woche/);
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
