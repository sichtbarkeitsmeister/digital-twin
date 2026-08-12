/**
 * Grounding page live date detection helpers.
 * Run: npx tsx scripts/test-detect-grounding-page-date.ts
 */
import assert from "node:assert/strict";

import {
  extractGroundingDateSignalsFromHtml,
  parseHttpDate,
  pickBestGroundingDateSignal,
} from "../lib/dt/seo/detect-grounding-page-date";

assert.equal(
  parseHttpDate("Wed, 15 Jan 2026 12:00:00 GMT")?.slice(0, 10),
  "2026-01-15",
);
assert.equal(parseHttpDate("not-a-date"), null);

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
// Modified signals preferred; among modified, newest wins (Mar 1 > Feb 20)
assert.equal(best!.source, "meta_article_modified");
assert.equal(best!.at.slice(0, 10), "2026-03-01");

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

console.log("detect-grounding-page-date tests: ok");
