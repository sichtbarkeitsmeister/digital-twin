import assert from "node:assert/strict";

import {
  extractSitemapLocs,
  isSameCrawlSite,
  normaliseUrl,
} from "../lib/dt/seo/crawl-url";
import {
  countCrawlViewerPages,
  coverageUrlsEqual,
  crawlPagesToCsv,
  deriveIndexReason,
  derivePageIndexStatus,
  filterCrawlViewerPages,
  isCoverageRedirectVariant,
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
  assert.equal(
    derivePageIndexStatus({ gscSynced: true, inGsc: true, gscExactMatch: false }),
    "not_indexed",
  );
  assert.equal(
    derivePageIndexStatus({ gscSynced: true, inGsc: true, redirected: true }),
    "not_indexed",
  );
  assert.equal(isCoverageRedirectVariant("https://example.de/a", "https://www.example.de/a"), true);
  assert.equal(isCoverageRedirectVariant("https://www.example.de/a", "https://www.example.de/a"), false);
  assert.equal(coverageUrlsEqual("https://www.example.de/a/", "https://www.example.de/a"), true);
  assert.equal(
    deriveIndexReason({
      status: "not_indexed",
      gscExactMatch: false,
      redirectTarget: "https://www.example.de/a",
    }),
    "Seite mit Weiterleitung → https://www.example.de/a",
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

  assert.equal(merged.length, 4);
  const crawledHome = merged.find((p) => p.url === "https://example.de/home");
  assert.equal(crawledHome?.inGsc, true);
  assert.equal(crawledHome?.indexStatus, "not_indexed");
  assert.equal(crawledHome?.isRedirect, true);
  assert.match(crawledHome?.indexReason ?? "", /Seite mit Weiterleitung/);
  assert.equal(crawledHome?.redirectTarget, "https://www.example.de/home");
  const indexedHome = merged.find((p) => p.url === "https://www.example.de/home");
  assert.equal(indexedHome?.inCrawl, false);
  assert.equal(indexedHome?.indexStatus, "indexed");
  assert.equal(indexedHome?.isRedirect, false);
  const secret = merged.find((p) => p.url.includes("/geheim"));
  assert.equal(secret?.indexStatus, "not_indexed");
  assert.equal(secret?.isRedirect, false);
  const gscOnly = merged.find((p) => p.url.includes("/gsc-only"));
  assert.equal(gscOnly?.inCrawl, false);
  assert.equal(gscOnly?.indexStatus, "indexed");

  const filtered = filterCrawlViewerPages(merged, { index: "not_indexed" });
  assert.equal(filtered.length, 2);
  const redirects = filterCrawlViewerPages(merged, { index: "redirect" });
  assert.equal(redirects.length, 1);
  assert.equal(redirects[0]?.url, "https://example.de/home");

  const counts = countCrawlViewerPages(merged);
  assert.equal(counts.indexed, 2);
  assert.equal(counts.notIndexed, 2);
  assert.equal(counts.gscOnly, 2);
  assert.equal(counts.redirects, 1);
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

function testCsvExport() {
  const csv = crawlPagesToCsv([
    {
      url: 'https://example.de/a;b',
      title: 'Titel "X"',
      h1: "H1",
      meta_description: "Zeile 1\nZeile 2",
      is_excluded: false,
      crawled_at: "2026-09-29T10:00:00.000Z",
      inCrawl: true,
      inGsc: true,
      indexStatus: "indexed",
      indexReason: null,
      isRedirect: false,
      redirectTarget: null,
      gscClicks: 4,
      gscImpressions: 80,
      gscPosition: 3.2,
      inspectionCoverage: null,
      inspectionVerdict: null,
    },
    {
      url: "https://example.de/geheim",
      title: null,
      h1: null,
      meta_description: null,
      is_excluded: true,
      crawled_at: null,
      inCrawl: true,
      inGsc: false,
      indexStatus: "not_indexed",
      indexReason: "Gecrawlt, derzeit nicht indexiert",
      isRedirect: false,
      redirectTarget: null,
      gscClicks: null,
      gscImpressions: null,
      gscPosition: null,
      inspectionCoverage: "Crawled - currently not indexed",
      inspectionVerdict: "NEUTRAL",
    },
  ]);

  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /URL;Titel;H1;Meta-Description;Indexstatus;Indexgrund;Weiterleitung;Weiterleitung-Ziel;Im Crawl;In Search Console/);
  assert.match(csv, /Indexiert;;nein;;ja;ja;80;4;3.2/);
  assert.match(csv, /Nicht indexiert;Gecrawlt, derzeit nicht indexiert;nein;;ja;nein;;;;Crawled - currently not indexed;NEUTRAL;ja;/);
  assert.match(csv, /"https:\/\/example\.de\/a;b"/);
  assert.match(csv, /"Titel ""X"""/);
  console.log("csv export: ok");
}

testSameSite();
testSitemapLocs();
testIndexStatus();
testMerge();
testMapGscRows();
testWaitForGsc();
testCsvExport();
console.log("All gsc crawl index tests passed.");
