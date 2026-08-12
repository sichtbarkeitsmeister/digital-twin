/**
 * Monthly SEO report queue helpers.
 * Run: npx tsx scripts/test-seo-monthly-report-queue.ts
 */
import assert from "node:assert/strict";

import { evaluateSeoReportReadiness } from "../lib/dt/seo/report-readiness";

// Ready org
{
  const r = evaluateSeoReportReadiness({
    organisationSlug: "allround",
    websiteUrl: "https://example.com",
    ga4Account: "ads@sichtbarkeitsmeister.de",
    gscAccount: "ads@sichtbarkeitsmeister.de",
  });
  assert.equal(r.ok, true);
}

// Missing website → not ready for monthly queue
{
  const r = evaluateSeoReportReadiness({
    organisationSlug: "allround",
    websiteUrl: "",
    ga4Account: "ads@sichtbarkeitsmeister.de",
    gscAccount: "ads@sichtbarkeitsmeister.de",
  });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.code === "missing_website"));
}

console.log("seo-monthly-report-queue tests: ok");
