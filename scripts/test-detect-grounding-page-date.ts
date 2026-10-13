/**
 * Grounding page live date + review fact detection helpers.
 * Run: npx tsx scripts/test-detect-grounding-page-date.ts
 */
import assert from "node:assert/strict";

import {
  deriveGroundingPageLiveFacts,
  extractGroundingDateSignalsFromHtml,
  extractGroundingPageHtml,
  parseHttpDate,
  parseStandardVersion,
  parseVisibleDate,
  parseVisibleReviewNotice,
  pickBestGroundingDateSignal,
} from "../lib/dt/seo/detect-grounding-page-date";

assert.equal(
  parseHttpDate("Wed, 15 Jan 2026 12:00:00 GMT")?.slice(0, 10),
  "2026-01-15",
);
assert.equal(parseHttpDate("not-a-date"), null);

assert.equal(parseVisibleDate("2026-10-12")?.slice(0, 10), "2026-10-12");
assert.equal(parseVisibleDate("12.10.2026")?.slice(0, 10), "2026-10-12");
assert.equal(parseVisibleDate("12. Oktober 2026")?.slice(0, 10), "2026-10-12");
assert.equal(parseVisibleDate("31.02.2026"), null);
assert.equal(parseVisibleDate("JJJJ-MM-TT"), null);

assert.equal(parseStandardVersion("Grounding Page Standard v1.7 – groundingpage.com"), "1.7");
assert.equal(parseStandardVersion("Standard: Grounding Page Standard 1.6"), "1.6");
assert.equal(parseStandardVersion("kein Standard"), null);

const html = `
<html><head>
<meta property="article:modified_time" content="2026-03-01T10:00:00Z" />
<meta property="article:published_time" content="2025-01-01T10:00:00Z" />
<script type="application/ld+json">
{"@type":"WebPage","dateModified":"2026-02-20T08:00:00Z","datePublished":"2025-06-01"}
</script>
</head></html>
`;

const signals = extractGroundingDateSignalsFromHtml(html);
assert.ok(signals.some((s) => s.source === "meta_article_modified"));
assert.ok(signals.some((s) => s.source === "jsonld_date_modified"));

const best = pickBestGroundingDateSignal(signals);
assert.ok(best);
// Tool-prompt order: JSON-LD dateModified beats Meta tags even when older.
assert.equal(best!.source, "jsonld_date_modified");
assert.equal(best!.at.slice(0, 10), "2026-02-20");

const headerOnly = pickBestGroundingDateSignal([
  {
    source: "http_last_modified",
    at: "2026-04-01T00:00:00.000Z",
    label: "HTTP Last-Modified",
  },
  {
    source: "jsonld_date_published",
    at: "2026-05-01T00:00:00.000Z",
    label: "JSON-LD datePublished",
  },
]);
assert.equal(headerOnly?.source, "http_last_modified");

// Standard v1.7 page: lastReviewed + reviewedBy in JSON-LD, mirrored visibly.
const v17 = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","@id":"https://example.com/grounding/#organization","name":"Beispiel GmbH"},
 {"@type":"WebPage","@id":"https://example.com/grounding/","dateModified":"2026-10-01",
  "lastReviewed":"2026-10-02","reviewedBy":{"@type":"Person","name":"Erika Mustermann"}}
]}
</script>
</head><body>
<h1>Beispiel GmbH</h1>
<p class="review-notice">Fakten geprüft von Erika Mustermann · Zuletzt von einem Menschen geprüft: 2026-10-02</p>
<p>Grounding Page Standard v1.7 – groundingpage.com/spec</p>
</body></html>`;

const extracted = extractGroundingPageHtml(v17);
assert.equal(extracted.jsonLdReviewedBy, "Erika Mustermann");
assert.equal(extracted.visibleNotice.reviewedBy, "Erika Mustermann");
assert.equal(extracted.visibleNotice.lastReviewed?.slice(0, 10), "2026-10-02");
assert.equal(extracted.standardVersion, "1.7");

const facts = deriveGroundingPageLiveFacts(extracted, [
  { source: "http_last_modified", at: "2026-10-05T00:00:00.000Z", label: "HTTP Last-Modified" },
]);
assert.equal(facts.lastReviewed?.slice(0, 10), "2026-10-02");
assert.equal(facts.lastReviewedSource, "jsonld_last_reviewed");
assert.equal(facts.reviewedBy, "Erika Mustermann");
assert.equal(facts.dateModified?.slice(0, 10), "2026-10-01");
assert.equal(facts.dateModifiedSource, "jsonld_date_modified");
assert.equal(facts.reviewMismatch, false);

const bestV17 = pickBestGroundingDateSignal(extracted.signals);
assert.equal(bestV17?.source, "jsonld_last_reviewed");

// Mismatch: visible notice names another reviewer / date than JSON-LD → Befund.
const mismatch = extractGroundingPageHtml(
  v17.replace("Erika Mustermann · Zuletzt", "Max Beispiel · Zuletzt"),
);
assert.equal(deriveGroundingPageLiveFacts(mismatch).reviewMismatch, true);

// Human-Verified block labels ("Geprüft von", "Zuletzt geprüft") with German date.
const block = parseVisibleReviewNotice(
  "Human Verified, Grounding Page Standard. Geprüft von Beispielredaktion Zuletzt geprüft 12. Oktober 2026 Standard Grounding Page Standard 1.7",
);
assert.equal(block.reviewedBy, "Beispielredaktion");
assert.equal(block.lastReviewed?.slice(0, 10), "2026-10-12");

// v1.6 page: no review notice → no lastReviewed, dateModified still read.
const v16 = extractGroundingPageHtml(
  `<html><body><p>Zuletzt redaktionell geprüft: 01.01.2026</p><p>Grounding Page Standard v1.6</p>
   <script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-05-18"}</script></body></html>`,
);
const v16Facts = deriveGroundingPageLiveFacts(v16);
assert.equal(v16Facts.lastReviewed, null);
assert.equal(v16Facts.reviewedBy, null);
assert.equal(v16Facts.dateModified?.slice(0, 10), "2026-05-18");
assert.equal(v16Facts.standardVersion, "1.6");

console.log("detect-grounding-page-date tests: ok");
