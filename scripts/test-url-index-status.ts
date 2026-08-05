import assert from "node:assert/strict";

import { formatDtSeoUrlIndexStatusForTool } from "../lib/dt/seo/url-index-status";

function testEmpty() {
  const text = formatDtSeoUrlIndexStatusForTool([]);
  assert.match(text, /Keine Google-URL-Inspection-Daten|keine Google-URL-Inspection/i);
  assert.match(text, /request_gsc_index_check/);
  console.log("empty index status: ok");
}

function testRows() {
  const text = formatDtSeoUrlIndexStatusForTool([
    {
      id: "1",
      organisation_id: "org",
      url: "https://example.de/",
      inspected_at: "2026-08-05T10:00:00.000Z",
      verdict: "PASS",
      coverage_state: "Submitted and indexed",
      indexing_state: "INDEXING_ALLOWED",
      page_fetch_state: "SUCCESSFUL",
      robots_txt_state: "ALLOWED",
      crawled_as: "MOBILE",
      sitemap: null,
      referring_urls: [],
      raw: {},
    },
  ]);
  assert.match(text, /https:\/\/example\.de\//);
  assert.match(text, /PASS/);
  assert.match(text, /Submitted and indexed/);
  console.log("formatted index status: ok");
}

testEmpty();
testRows();
console.log("All url-index-status tests passed.");
