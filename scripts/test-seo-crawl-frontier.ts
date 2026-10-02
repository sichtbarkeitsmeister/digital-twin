import assert from "node:assert/strict";

import { gzipSync } from "node:zlib";

import {
  decodeSitemapBuffer,
  isCrawlablePageUrl,
  looksLikeSitemapXml,
} from "../lib/dt/seo/crawl-sitemap";
import {
  crawlJobDedupeKey,
  isStaleCrawlProgress,
  STALE_CRAWL_PROGRESS_MS,
} from "../lib/dt/seo/sync-crawl-job-health";

function testSitemapXmlDetection() {
  assert.equal(
    looksLikeSitemapXml(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`),
    true,
  );
  assert.equal(
    looksLikeSitemapXml(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.de/</loc></url></urlset>`),
    true,
  );
  assert.equal(
    looksLikeSitemapXml(`<!doctype html><html lang="de"><head><title>Home</title></head><body>Hallo</body></html>`),
    false,
  );
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.de/</loc></url></urlset>`;
  assert.equal(decodeSitemapBuffer(Buffer.from(xml, "utf8")), xml);
  assert.equal(decodeSitemapBuffer(gzipSync(Buffer.from(xml, "utf8"))), xml);
  console.log("sitemap xml detection: ok");
}

function testCrawlableUrls() {
  const origin = "https://existenzstand.de";
  assert.equal(isCrawlablePageUrl("https://existenzstand.de/kontakt/", origin), true);
  assert.equal(isCrawlablePageUrl("https://existenzstand.de/gruendungsberatung/", origin), true);
  assert.equal(isCrawlablePageUrl("https://existenzstand.de/?s=avgs", origin), false);
  assert.equal(
    isCrawlablePageUrl(
      "https://existenzstand.de/wp-content/plugins/elementor/assets/css/widget-heading.min.css?ver=4.3.3",
      origin,
    ),
    false,
  );
  assert.equal(isCrawlablePageUrl("https://existenzstand.de/feed/", origin), false);
  assert.equal(isCrawlablePageUrl("https://existenzstand.de/wp-json/oembed/1.0/embed", origin), false);
  assert.equal(isCrawlablePageUrl("https://other.de/kontakt/", origin), false);
  console.log("crawlable urls: ok");
}

function testStaleProgress() {
  const now = Date.parse("2026-10-02T08:00:00.000Z");
  assert.equal(isStaleCrawlProgress("2026-10-02T07:59:00.000Z", now), false);
  assert.equal(
    isStaleCrawlProgress(new Date(now - STALE_CRAWL_PROGRESS_MS - 1).toISOString(), now),
    true,
  );
  assert.equal(isStaleCrawlProgress(null, now), true);
  assert.equal(crawlJobDedupeKey("abc"), "seo.crawl:abc");
  console.log("stale crawl progress: ok");
}

testSitemapXmlDetection();
testCrawlableUrls();
testStaleProgress();
console.log("All seo crawl frontier tests passed.");
