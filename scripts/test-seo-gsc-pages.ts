import assert from "node:assert/strict";

import {
  extractSitemapLocs,
  isSameCrawlSite,
  normaliseUrl,
} from "../lib/dt/seo/crawl-url";
import {
  countCrawlViewerPages,
  derivePageIndexStatus,
  filterCrawlViewerPages,
  mapGscAnalyticsRows,
  mergeCrawlAndGscPages,
  shouldWaitForGscSync,
} from "../lib/dt/seo/gsc-pages";

function testSameSite() {
  assert.equal(isSameCrawlSite("https://www.example.de/a", "https://example.de"), true);
  assert.equal(isSameCrawlSite("http://example.de/a", "https://www.example.de"), true);
  assert.equal(isSameCrawlSite("https://blog.example.de/a", "https://example.de"), false);
  assert.equal(isSameCrawlSite("https://other.de/a", "https://example.de"), false);
  console.log("same-site matching: ok");
}

function testSitemapLocs() {
  const xml = `
    <urlset>
      <loc>https://example.de/a</loc>
      <loc><![CDATA[https://example.de/b?x=1&amp;y=2]]></loc>
      <loc>https://example.de/c?foo=1&amp;bar=2</loc>
    </urlset>
  `;
  const locs = extractSitemapLocs(xml);
  assert.deepEqual(locs, [
    "https://example.de/a",
    "https://example.de/b?x=1&y=2",
    "https://example.de/c?foo=1&bar=2",
  ]);
  console.log("sitemap loc parsing: ok");
}

function testIndexStatus() {
  assert.equal(
    derivePageIndexStatus({ gscSynced: true, inGsc: true }),
    "indexed",
  );
  assert.equal(
    derivePageIndexStatus({ gscSynced: true, inGsc: false }),
    "not_indexed",
  );
  assert.equal(
    derivePageIndexStatus({ gscSynced: false, inGsc: false }),
    "unknown",
  );
  assert.equal(
    derivePageIndexStatus({
      gscSynced: true,
      inGsc: false,
      inspectionCoverage: "Submitted and indexed",
      inspectionVerdict: "PASS",
    }),
    "indexed",
  );
  assert.equal(
    derivePageIndexStatus({
      gscSynced: true,
      inGsc: true,
      inspectionCoverage: "Crawled - currently not indexed",
      inspectionVerdict: "NEUTRAL",
    }),
    "not_indexed",
  );
  console.log("index status: ok");
}

function testMerge() {
  const merged = mergeCrawlAndGscPages({
    crawled: [
      {
        url: "https://example.de/home",
        title: "Home",
        h1: "Home",
        meta_description: null,
        is_excluded: false,
        crawled_at: "2026-09-16T10:00:00.000Z",
      },
      {
        url: "https://example.de/geheim",
        title: "Geheim",
        h1: null,
        meta_description: null,
        is_excluded: false,
        crawled_at: "2026-09-16T10:00:00.000Z",
      },
    ],
    gscPages: [
      {
        url: "https://www.example.de/home",
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 4.2,
        fetched_at: "2026-09-16T11:00:00.000Z",
        period_start: "2026-06-18",
        period_end: "2026-09-16",
      },
      {
        url: "https://example.de/gsc-only",
        clicks: 1,
        impressions: 20,
        ctr: 0.05,
        position: 8,
        fetched_at: "2026-09-16T11:00:00.000Z",
        period_start: "2026-06-18",
        period_end: "2026-09-16",
      },
    ],
    gscSynced: true,
    origin: "https://example.de",
  });

  assert.equal(merged.length, 3);
  const home = merged.find((p) => p.url.includes("/home"));
  assert.equal(home?.inGsc, true);
  assert.equal(home?.indexStatus, "indexed");
  const secret = merged.find((p) => p.url.includes("/geheim"));
  assert.equal(secret?.indexStatus, "not_indexed");
  const gscOnly = merged.find((p) => p.url.includes("/gsc-only"));
  assert.equal(gscOnly?.inCrawl, false);
  assert.equal(gscOnly?.indexStatus, "indexed");

  const filtered = filterCrawlViewerPages(merged, { index: "not_indexed" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.url.includes("/geheim"), true);

  const counts = countCrawlViewerPages(merged);
  assert.equal(counts.indexed, 2);
  assert.equal(counts.notIndexed, 1);
  assert.equal(counts.gscOnly, 1);
  console.log("merge + filter: ok");
}

function testMapGscRows() {
  const rows = mapGscAnalyticsRows(
    [
      { keys: ["https://www.example.de/a/"], clicks: 2, impressions: 9, position: 3 },
      { keys: ["https://other.de/x"], clicks: 1, impressions: 1 },
    ],
    "https://example.de",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.url, normaliseUrl("https://www.example.de/a/"));
  console.log("gsc row mapping: ok");
}

function testWaitForGsc() {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  assert.equal(
    shouldWaitForGscSync({
      status: "pending",
      startedAt: "2026-09-16T11:55:00.000Z",
      now,
    }),
    true,
  );
  assert.equal(
    shouldWaitForGscSync({
      status: "pending",
      startedAt: "2026-09-16T11:00:00.000Z",
      now,
    }),
    false,
  );
  assert.equal(shouldWaitForGscSync({ status: "done", startedAt: "2026-09-16T11:55:00.000Z", now }), false);
  console.log("gsc wait window: ok");
}

testSameSite();
testSitemapLocs();
testIndexStatus();
testMerge();
testMapGscRows();
testWaitForGsc();
console.log("All gsc crawl index tests passed.");
