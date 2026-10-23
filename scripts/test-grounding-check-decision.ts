/**
 * Grounding check: decision, schedule, normalising Claude's answers (facts need a crawled
 * source and a quote that is on that page), model order and the tool_choice fallback.
 * Run: npx tsx scripts/test-grounding-check-decision.ts
 */
import assert from "node:assert/strict";

import { isForcedToolChoiceUnsupportedError } from "../lib/ai/anthropic-helpers";
import { checklistComplete, normalizeChecklist } from "../lib/dt/seo/grounding-check/review";
import { decideGroundingCheck } from "../lib/dt/seo/grounding-check/decision";
import { computeGroundingDiff, buildSemanticRequest } from "../lib/dt/seo/grounding-check/diff";
import { normaliseSourceUrl, normalizeExtractedFactModel } from "../lib/dt/seo/grounding-check/fact-model";
import { groundingCheckModels } from "../lib/dt/seo/grounding-check/model";
import { normalizeSemanticVerdicts } from "../lib/dt/seo/grounding-check/prompts";
import { shouldScheduleGroundingCheck } from "../lib/dt/seo/grounding-check/schedule";
import { GROUNDING_REVIEW_CHECKLIST } from "../lib/dt/prompts/grounding-page-standard";
import { PAGE_URL, SITE, websiteModel } from "./grounding-check-fixtures";

// --- decision ---------------------------------------------------------------------------------
const model = websiteModel();
const same = computeGroundingDiff(model, model);
const changed = (() => {
  const prev = websiteModel();
  prev.entities[0]!.facts.find((f) => f.key === "phone")!.value = "02381 11111";
  return computeGroundingDiff(model, prev);
})();
const structuralOnly = computeGroundingDiff(model, model, undefined, [{ code: "missing_review", severity: "high", message: "reviewedBy fehlt." }]);

assert.equal(decideGroundingCheck({ pageExists: false, diff: null, scheduleStatus: "missing" }).decision, "create");
assert.equal(decideGroundingCheck({ pageExists: true, diff: changed, scheduleStatus: "ok" }).decision, "update_required");
assert.match(decideGroundingCheck({ pageExists: true, diff: changed, scheduleStatus: "ok" }).reasons[0]!, /1 geändert/);
assert.equal(decideGroundingCheck({ pageExists: true, diff: structuralOnly, scheduleStatus: "ok" }).decision, "update_required", "a v1.7 issue alone needs an update");
assert.equal(decideGroundingCheck({ pageExists: true, diff: changed, scheduleStatus: "overdue" }).decision, "update_required", "content beats dates");
assert.equal(decideGroundingCheck({ pageExists: true, diff: same, scheduleStatus: "due_soon" }).decision, "refresh_only");
assert.equal(decideGroundingCheck({ pageExists: true, diff: same, scheduleStatus: "overdue" }).decision, "refresh_only");
assert.equal(decideGroundingCheck({ pageExists: true, diff: same, scheduleStatus: "ok" }).decision, "up_to_date");

// --- schedule ---------------------------------------------------------------------------------
const now = new Date("2026-10-23T08:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const reviewedDaysAgo = (n: number) => ({ lastReviewed: daysAgo(n), uploadedAt: null });

assert.equal(shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(30), runs: [], now }).schedule, false, "not due");
assert.equal(shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(85), runs: [], now }).schedule, true, "due soon");
assert.equal(shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(120), runs: [], now }).schedule, true, "overdue");
assert.equal(
  shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(120), runs: [{ status: "draft", createdAt: daysAgo(40) }], now }).schedule,
  false,
  "an open draft blocks a new run",
);
assert.equal(shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(120), runs: [{ status: "approved", createdAt: daysAgo(60) }], now }).schedule, false);
assert.equal(shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(120), runs: [{ status: "running", createdAt: daysAgo(0) }], now }).schedule, false);
assert.equal(
  shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(85), runs: [{ status: "up_to_date", createdAt: daysAgo(2) }], now }).schedule,
  false,
  "one run per due window",
);
assert.equal(
  shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(150), runs: [{ status: "rejected", createdAt: daysAgo(10) }], now }).schedule,
  false,
  "a rejected draft is not re-run at once",
);
assert.equal(
  shouldScheduleGroundingCheck({ hub: reviewedDaysAgo(150), runs: [{ status: "rejected", createdAt: daysAgo(35) }], now }).schedule,
  true,
  "overdue pages are re-checked monthly",
);
assert.equal(shouldScheduleGroundingCheck({ hub: { lastReviewed: null, uploadedAt: null }, runs: [], now }).schedule, true, "hub without any date");
assert.equal(shouldScheduleGroundingCheck({ hub: null, runs: [], now }).schedule, true, "no grounding page");
assert.equal(shouldScheduleGroundingCheck({ hub: null, runs: [{ status: "rejected", createdAt: daysAgo(40) }], now }).schedule, false);
assert.equal(shouldScheduleGroundingCheck({ hub: null, runs: [{ status: "failed", createdAt: daysAgo(100) }], now }).schedule, true);
// The upload date counts while no review is documented.
assert.equal(shouldScheduleGroundingCheck({ hub: { lastReviewed: null, uploadedAt: daysAgo(100) }, runs: [], now }).schedule, true);

// --- normalising the extraction ---------------------------------------------------------------
const impressum = `${SITE}/impressum/`;
const pageTexts = new Map([
  [normaliseSourceUrl(impressum), "Impressum Beispiel Bau GmbH Musterstraße 12 59065 Hamm Geschäftsführerin: Anna Muster Registergericht Hamm HRB 12345 Tel. 02381 98765-0"],
  [normaliseSourceUrl(`${SITE}/`), "Startseite [Profile] https://www.linkedin.com/company/beispiel-bau Kundenbewertung 4,9 von 5 Sternen bei Google"],
]);
const extracted = normalizeExtractedFactModel(
  {
    entities: [
      {
        kind: "person",
        name: "Anna Muster",
        ontologyClass: "Person Entity Class",
        schemaType: "Person",
        definition: "Anna Muster ist Geschäftsführerin der Beispiel Bau GmbH.",
        definitionSourceUrl: impressum,
        disambiguation: [],
        facts: [{ key: "jobTitle", value: "Geschäftsführerin", sourceUrl: impressum, quote: "Geschäftsführerin: Anna Muster", volatile: false, asOf: "" }],
      },
      {
        kind: "organization",
        name: "Beispiel Bau GmbH",
        ontologyClass: "Organization Entity Class",
        schemaType: "SpaceAgency",
        definition: "Die Beispiel Bau GmbH ist ein Dachdeckerbetrieb in Hamm.",
        definitionSourceUrl: "https://www.beispiel-bau.de/impressum",
        disambiguation: ["Nicht die Beispiel Bau AG."],
        facts: [
          { key: "address", value: "Musterstraße 12, 59065 Hamm", sourceUrl: "https://beispiel-bau.de/impressum", quote: "Musterstraße 12 59065 Hamm", volatile: false, asOf: "" },
          { key: "registerEntry", value: "HRB 12345", sourceUrl: impressum, quote: "HRB 12345", volatile: false, asOf: "" },
          { key: "legalForm", value: "Gesellschaft mit beschränkter Haftung", sourceUrl: impressum, quote: "Beispiel Bau GmbH", volatile: false, asOf: "" },
          { key: "foundingDate", value: "1999", sourceUrl: impressum, quote: "gegründet 1999", volatile: false, asOf: "" },
          { key: "vatId", value: "DE999", sourceUrl: `${SITE}/nicht-gelesen/`, quote: "DE999", volatile: false, asOf: "" },
          { key: "jobTitle", value: "Chef", sourceUrl: impressum, quote: "Anna Muster", volatile: false, asOf: "" },
          { key: "sameAs", value: "https://www.linkedin.com/company/beispiel-bau", sourceUrl: `${SITE}/`, quote: "https://www.linkedin.com/company/beispiel-bau", volatile: false, asOf: "" },
          { key: "rating", value: "4,9 von 5 Sternen bei Google", sourceUrl: `${SITE}/`, quote: "4,9 von 5 Sternen bei Google", volatile: true, asOf: "" },
        ],
      },
    ],
    faq: [
      { question: "Wo sitzt die Beispiel Bau GmbH?", answer: "Die Beispiel Bau GmbH sitzt in Hamm.", sourceUrl: impressum, quote: "59065 Hamm" },
      { question: "Seit wann gibt es die Firma?", answer: "Seit 1999.", sourceUrl: impressum, quote: "seit 1999" },
    ],
    openPoints: [{ reason: "internal_only", text: "Laut Fragebogen gegründet 2001.", entityName: "Beispiel Bau GmbH", source: "Fragebogen" }],
  },
  { organisationName: "Beispiel Bau GmbH", websiteUrl: `${SITE}/`, pageUrl: PAGE_URL, month: "2026-10", pageTexts },
);
const org = extracted.entities[0]!;
assert.equal(org.kind, "organization", "the organisation comes first");
assert.equal(org.id, "organisation");
assert.equal(org.schemaType, "Organization", "unknown schema types fall back");
assert.equal(org.definitionSourceUrl, "https://www.beispiel-bau.de/impressum", "www/trailing slash do not matter");
const keys = org.facts.map((f) => f.key);
assert.ok(keys.includes("address"), "same page under another host spelling");
assert.ok(keys.includes("registerEntry"));
assert.ok(!keys.includes("foundingDate"), "quote not on the page → no fact");
assert.ok(!keys.includes("vatId"), "page not crawled → no fact");
assert.ok(!keys.includes("jobTitle"), "key not allowed for the kind");
assert.equal(org.facts.find((f) => f.key === "legalForm")?.value, "GmbH");
const rating = org.facts.find((f) => f.key === "rating")!;
assert.equal(rating.included, false, "ratings stay off the page until a person decides");
assert.equal(rating.volatile, true);
assert.equal(rating.asOf, "2026-10", "volatile facts get the current month");
assert.equal(extracted.faq.length, 1, "an FAQ answer needs its quote");
const reasons = extracted.openPoints.map((p) => p.reason);
assert.ok(reasons.filter((r) => r === "unverified").length >= 4, "dropped facts become open points");
assert.ok(reasons.includes("internal_only"));
assert.ok(reasons.includes("not_publishable"));
assert.ok(extracted.openPoints.some((p) => /1999/.test(p.text)));

// No organisation in the answer: one is created, so the page always has its main entity.
const empty = normalizeExtractedFactModel({ entities: [], faq: [], openPoints: [] }, { organisationName: "X GmbH", websiteUrl: `${SITE}/`, pageUrl: PAGE_URL, month: "2026-10", pageTexts });
assert.equal(empty.entities[0]?.name, "X GmbH");

// --- semantic verdicts only for ids that were asked -------------------------------------------
const prev = websiteModel();
prev.entities[0]!.definition = "Beispiel Bau GmbH ist ein Dachdecker aus Hamm.";
const request = buildSemanticRequest(model, prev);
const verdicts = normalizeSemanticVerdicts(
  {
    entityMatches: [{ newId: "erfunden", oldId: "auch-erfunden" }],
    definitionVerdicts: [{ id: "organisation:definition", same: true, note: "" }, { id: "nicht-gefragt", same: true, note: "" }],
    faqMatches: [],
  },
  request,
);
assert.deepEqual(verdicts.entityMatches, []);
assert.deepEqual(verdicts.definitionVerdicts.map((v) => v.id), ["organisation:definition"]);

// --- models, checklist, tool_choice fallback --------------------------------------------------
assert.deepEqual(groundingCheckModels({ ANTHROPIC_DT_GROUNDING_MODEL: "model-a", ANTHROPIC_DT_SEO_MODEL: "model-b" }), ["model-a", "model-b"]);
assert.deepEqual(groundingCheckModels({ ANTHROPIC_DT_SEO_MODEL: "model-b" }), ["model-b"]);
assert.equal(groundingCheckModels({}).length, 1, "falls back to the SEO default");

assert.equal(checklistComplete(Object.fromEntries(GROUNDING_REVIEW_CHECKLIST.map((i) => [i.id, true]))), true);
assert.equal(checklistComplete({ richtigkeit: true }), false);
assert.equal(GROUNDING_REVIEW_CHECKLIST.length, 6);
assert.deepEqual(Object.values(normalizeChecklist({ richtigkeit: true, fremd: true, quellen: "ja" })).filter(Boolean).length, 1);

const forced = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"tool_choice: type \\"tool\\" and \\"any\\" are not supported for this model."}}'), { status: 400 });
assert.equal(isForcedToolChoiceUnsupportedError(forced), true);
assert.equal(isForcedToolChoiceUnsupportedError(Object.assign(new Error("tool_choice not supported"), { status: 500 })), false);
assert.equal(isForcedToolChoiceUnsupportedError(Object.assign(new Error("max_tokens too large"), { status: 400 })), false);

console.log("grounding-check decision tests: ok");
