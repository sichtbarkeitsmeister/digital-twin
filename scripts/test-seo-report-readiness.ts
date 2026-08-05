/**
 * SEO report readiness helpers.
 * Run: npx tsx scripts/test-seo-report-readiness.ts
 */
import assert from "node:assert/strict";

import { evaluateSeoReportReadiness } from "../lib/dt/seo/report-readiness";

const ready = evaluateSeoReportReadiness({
  organisationSlug: "msh-rechtsanwaelte",
  websiteUrl: "https://www.msh-rechtsanwaelte.de/",
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscAccount: "ads2@sichtbarkeitsmeister.de",
});
assert.equal(ready.ok, true);
assert.equal(ready.issues.length, 0);

const blocked = evaluateSeoReportReadiness({
  organisationSlug: null,
  websiteUrl: null,
  ga4Account: null,
  gscAccount: null,
});
assert.equal(blocked.ok, false);
assert.ok(blocked.blockers.some((b) => b.code === "missing_slug"));
assert.ok(blocked.blockers.some((b) => b.code === "missing_website"));
assert.ok(blocked.warnings.some((w) => w.code === "missing_ga4_account"));
assert.ok(blocked.warnings.some((w) => w.code === "missing_gsc_account"));

// Name-derived fallback is not enough — stored slug must be set.
const noStoredSlug = evaluateSeoReportReadiness({
  organisationSlug: null,
  websiteUrl: "https://example.com",
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscAccount: "ads@sichtbarkeitsmeister.de",
});
assert.equal(noStoredSlug.ok, false);
assert.ok(noStoredSlug.blockers.some((b) => b.code === "missing_slug"));

console.log("seo-report-readiness tests: ok");
