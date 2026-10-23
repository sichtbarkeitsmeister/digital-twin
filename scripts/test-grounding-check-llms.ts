/**
 * Grounding check: llms.txt in the house style, review stamp, date refresh and round trip.
 * Run: npx tsx scripts/test-grounding-check-llms.ts
 */
import assert from "node:assert/strict";

import { computeGroundingDiff } from "../lib/dt/seo/grounding-check/diff";
import { parseExistingGroundingPage } from "../lib/dt/seo/grounding-check/existing-page";
import { renderGroundingLlmsTxt } from "../lib/dt/seo/grounding-check/render-llms";
import { applyReviewToLlmsTxt, refreshDatesInLlmsTxt } from "../lib/dt/seo/grounding-check/review-stamp";
import { validateLlmsTxt } from "../lib/dt/seo/grounding-check/validate";
import { EXISTING_LLMS_TXT, LLMS_URL, PAGE_URL, SITE, websiteModel } from "./grounding-check-fixtures";

const model = websiteModel();
const llms = renderGroundingLlmsTxt({ model, llmsUrl: LLMS_URL, createdDay: "2026-10-01", modifiedDay: "2026-10-23", month: "2026-10" });
const lines = llms.split("\n");

// --- house style ------------------------------------------------------------------------------
assert.deepEqual(lines.slice(0, 5), [
  "# Beispiel Bau GmbH – llms.txt",
  "# Grounding Page Standard v1.6",
  "# Stand: Oktober 2026",
  `# Canonical: ${PAGE_URL}`,
  "# Erstellt: 2026-10-01 | Aktualisiert: 2026-10-23",
]);
const headings = lines.filter((l) => l.startsWith("## "));
assert.deepEqual(headings, ["## ORGANISATION", "## PERSONEN", "## LEISTUNGEN", "## STANDORTE", "## METADATEN"]);
assert.ok(llms.includes("entity: Beispiel Bau GmbH\nclass: Organization\nschema_type: RoofingContractor\ndefinition: Die Beispiel Bau GmbH ist"));
assert.ok(llms.includes("name_official: Beispiel Bau GmbH"));
assert.ok(llms.includes("legal_form: GmbH"));
assert.ok(llms.includes("register: HRB 12345, Amtsgericht Hamm"));
assert.ok(llms.includes("vat_id: DE123456789"));
assert.ok(llms.includes("employees: 25 (Stand Oktober 2026)"), "volatile values carry Stand");
assert.ok(llms.includes("social_linkedin: https://www.linkedin.com/company/beispiel-bau"));
assert.ok(llms.includes("scope:\n  - Steildach\n  - Flachdach"), "several values become a list");
assert.ok(llms.includes("\ndisambiguation: Die Beispiel Bau GmbH ist nicht identisch"));
assert.ok(!llms.includes("4,9 von 5"), "switched-off facts stay out");
assert.ok(llms.includes("\n\n---\n\n"), "entities separated by ---");
assert.equal((llms.match(/^entity: /gm) ?? []).length, 5);
const meta = llms.slice(llms.indexOf("## METADATEN"));
assert.ok(meta.includes(`grounding_page_url: ${PAGE_URL}`));
assert.ok(meta.includes(`llms_txt_url: ${LLMS_URL}`));
assert.ok(meta.includes("standard: Grounding Page Standard v1.6"));
assert.ok(meta.includes("language: de-DE"));
assert.ok(meta.includes("entity_count: 5"));
assert.ok(!/last_reviewed|reviewed_by|Geprüft/.test(llms), "no review before the review");
assert.ok(llms.endsWith("\n"));
assert.deepEqual(validateLlmsTxt(llms, { reviewed: false }), []);

// --- review stamp -----------------------------------------------------------------------------
const reviewed = applyReviewToLlmsTxt(llms, { day: "2026-10-24" });
assert.ok(reviewed.includes("# Grounding Page Standard v1.7"));
assert.ok(reviewed.includes("# Erstellt: 2026-10-01 | Aktualisiert: 2026-10-23 | Geprüft: 2026-10-24"));
assert.ok(reviewed.includes("standard: Grounding Page Standard v1.7"));
assert.ok(reviewed.includes("updated: 2026-10-23\nlast_reviewed: 2026-10-24\nreviewed_by: Sichtbarkeitsmeister GmbH"));
assert.deepEqual(validateLlmsTxt(reviewed, { reviewed: true, reviewDay: "2026-10-24" }), []);
assert.ok(validateLlmsTxt(reviewed, { reviewed: true, reviewDay: "2026-10-25" }).some((i) => i.severity === "error"));
assert.ok(validateLlmsTxt(llms, { reviewed: true }).some((i) => i.code === "llms_review"));
const twice = applyReviewToLlmsTxt(reviewed, { day: "2026-10-25" });
assert.equal((twice.match(/^last_reviewed:/gm) ?? []).length, 1, "re-approval replaces");
assert.ok(twice.includes("| Geprüft: 2026-10-25"));

// The old house-style file (v1.5, „Verifiziert“, „verified:“).
const legacy = applyReviewToLlmsTxt(EXISTING_LLMS_TXT, { day: "2026-10-24" });
assert.ok(legacy.includes("# Grounding Page Standard v1.7"));
assert.ok(legacy.includes("| Geprüft: 2026-10-24"));
assert.ok(!legacy.includes("Verifiziert"));
assert.ok(!/^verified:/m.test(legacy));
assert.ok(legacy.includes("standard: Grounding Page Project Standard v1.7"));
assert.ok(legacy.includes("last_reviewed: 2026-10-24"));

// --- refresh only -----------------------------------------------------------------------------
const refreshed = refreshDatesInLlmsTxt(EXISTING_LLMS_TXT, { day: "2026-10-23", month: "2026-10" });
assert.ok(refreshed.text.includes("# Stand: Oktober 2026"));
assert.ok(refreshed.text.includes("Aktualisiert: 2026-10-23"));
assert.ok(refreshed.text.includes("updated: 2026-10-23"));
assert.ok(refreshed.text.includes("Erstellt: 2026-03-17"), "creation date stays");
assert.ok(refreshed.changes.length > 0);

// --- round trip: what we write, we read back --------------------------------------------------
const back = parseExistingGroundingPage({
  pageUrl: PAGE_URL,
  html: null,
  llmsUrl: LLMS_URL,
  llmsTxt: llms,
  organisationName: "Beispiel Bau GmbH",
  websiteUrl: `${SITE}/`,
});
assert.equal(back.entities.length, 5);
const diff = computeGroundingDiff(model, back);
const drift = diff.items.filter((i) => i.scope !== "faq" && i.kind !== "unchanged");
assert.deepEqual(
  drift.map((i) => `${i.kind} ${i.entityName} ${i.label}: ${i.oldValue} → ${i.newValue}`),
  [],
  "llms.txt holds every published fact",
);

console.log("grounding-check llms tests: ok");
