/**
 * Crawl on-page SEO audit.
 * Run: npx tsx scripts/test-seo-crawl-onpage-audit.ts
 */
import assert from "node:assert/strict";

import {
  auditCrawledPages,
  auditStructuredDataSamples,
  summarizeSeoAudit,
} from "../lib/dt/seo/crawl-onpage-audit";

const empty = auditCrawledPages([]);
assert.ok(empty.some((f) => f.code === "crawl_empty"));

const pages = [
  {
    url: "https://example.com/",
    title: null,
    h1: null,
    meta_description: null,
    text_content: "Kurz",
  },
  {
    url: "https://example.com/a",
    title: "Gleicher Title",
    h1: "A",
    meta_description: "x".repeat(200),
    text_content: "y".repeat(500),
  },
  {
    url: "https://example.com/b",
    title: "Gleicher Title",
    h1: "B",
    meta_description: "Ok meta",
    text_content: "y".repeat(500),
  },
];

const findings = auditCrawledPages(pages);
assert.ok(findings.some((f) => f.code === "missing_title"));
assert.ok(findings.some((f) => f.code === "missing_h1"));
assert.ok(findings.some((f) => f.code === "missing_meta_description"));
assert.ok(findings.some((f) => f.code === "thin_content"));
assert.ok(findings.some((f) => f.code === "duplicate_title"));
assert.ok(findings.some((f) => f.code === "meta_too_long"));

const sd = auditStructuredDataSamples([
  { url: "https://example.com/", ok: true, hasJsonLd: false, types: [] },
  {
    url: "https://example.com/ok",
    ok: true,
    hasJsonLd: true,
    types: ["Organization"],
  },
]);
assert.ok(sd.some((f) => f.code === "missing_json_ld"));
assert.equal(sd.find((f) => f.code === "missing_json_ld")?.count, 1);

const summary = summarizeSeoAudit(findings);
assert.equal(summary.ok, false);
assert.ok(summary.errorCount > 0);

console.log("seo-crawl-onpage-audit: ok");
