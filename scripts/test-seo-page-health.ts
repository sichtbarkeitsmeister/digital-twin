/**
 * SEO page health aggregator (crawl + GA/GSC + config).
 * Run: npx tsx scripts/test-seo-page-health.ts
 */
import assert from "node:assert/strict";

import {
  evaluateSeoPageHealth,
  seoPageHealthHasIssues,
} from "../lib/dt/seo/page-health";

const clean = evaluateSeoPageHealth({
  organisationSlug: "demo",
  websiteUrl: "https://example.com",
  ga4PropertyId: "123",
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscSiteUrl: "https://example.com",
  gscAccount: "ads2@sichtbarkeitsmeister.de",
  crawledPageCount: 10,
  crawlStatus: "done",
});
assert.equal(clean.clean, true);
assert.equal(clean.ok, true);
assert.equal(seoPageHealthHasIssues(clean), false);

const crawlFail = evaluateSeoPageHealth({
  organisationSlug: "demo",
  websiteUrl: "https://example.com",
  ga4PropertyId: "123",
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscSiteUrl: "https://example.com",
  gscAccount: "ads@sichtbarkeitsmeister.de",
  crawledPageCount: 0,
  lastCrawlError: "Timeout beim Abruf der Sitemap.",
});
assert.equal(crawlFail.ok, false);
assert.ok(crawlFail.errors.some((e) => e.code === "crawl_error"));
assert.match(crawlFail.errors[0]?.message ?? "", /Timeout/);

const missingLinks = evaluateSeoPageHealth({
  organisationSlug: "demo",
  websiteUrl: "https://example.com",
  ga4PropertyId: null,
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscSiteUrl: null,
  gscAccount: "ads@sichtbarkeitsmeister.de",
  crawledPageCount: 5,
  crawlStatus: "done",
});
assert.equal(missingLinks.ok, true);
assert.ok(missingLinks.warnings.some((w) => w.code === "missing_ga4_property"));
assert.ok(missingLinks.warnings.some((w) => w.code === "missing_gsc_site_url"));

const reportFail = evaluateSeoPageHealth({
  organisationSlug: "demo",
  websiteUrl: "https://example.com",
  ga4PropertyId: "1",
  ga4Account: "ads@sichtbarkeitsmeister.de",
  gscSiteUrl: "https://example.com",
  gscAccount: "ads@sichtbarkeitsmeister.de",
  crawledPageCount: 3,
  lastReportState: "error",
  lastReportMessage: "n8n webhook timeout",
});
assert.ok(reportFail.errors.some((e) => e.code === "report_error"));

console.log("seo-page-health: ok");
