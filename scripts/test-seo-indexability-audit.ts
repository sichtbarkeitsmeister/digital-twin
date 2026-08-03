import assert from "node:assert/strict";

import {
  evaluateCanonical,
  formatIndexabilityAudit,
  type DtIndexabilityRow,
} from "../lib/dt/seo/indexability-audit";

function row(overrides: Partial<DtIndexabilityRow>): DtIndexabilityRow {
  return {
    url: "https://example.de/seite",
    status: 200,
    finalUrl: "https://example.de/seite",
    noindex: false,
    canonical: null,
    canonicalPointsElsewhere: false,
    redirected: false,
    inCrawlIndex: true,
    error: null,
    ...overrides,
  };
}

function testCanonicalEvaluation() {
  // Self-canonical and trailing-slash/www variants count as identical.
  assert.equal(
    evaluateCanonical("https://example.de/a", "https://example.de/a", "https://example.de/a"),
    false,
  );
  assert.equal(
    evaluateCanonical("https://example.de/a", "https://example.de/a", "https://www.example.de/a/"),
    false,
  );
  // Relative canonical resolves against the final URL.
  assert.equal(
    evaluateCanonical("https://example.de/a", "https://example.de/a", "/a"),
    false,
  );
  // Pointing at another page is a real blocker.
  assert.equal(
    evaluateCanonical("https://example.de/a", "https://example.de/a", "https://example.de/b"),
    true,
  );
  // No canonical at all is not a problem.
  assert.equal(evaluateCanonical("https://example.de/a", null, null), false);
  assert.equal(evaluateCanonical("https://example.de/a", null, "   "), false);
  // A broken canonical resolves somewhere else and is reported — that is a real defect.
  assert.equal(evaluateCanonical("https://example.de/a", null, "example.de/a"), true);
  console.log("canonical evaluation: ok");
}

function testAuditFormatting() {
  const text = formatIndexabilityAudit(
    [
      row({ url: "https://example.de/ok" }),
      row({ url: "https://example.de/weg", status: 404 }),
      row({ url: "https://example.de/versteckt", noindex: true }),
      row({
        url: "https://example.de/dublette",
        canonical: "https://example.de/original",
        canonicalPointsElsewhere: true,
      }),
      row({ url: "https://example.de/neu", inCrawlIndex: false }),
      row({ url: "https://example.de/tot", status: null, error: "Zeitüberschreitung" }),
    ],
    {
      source: "sitemap",
      sourceLabel: "Sitemap https://example.de/sitemap.xml",
      totalCandidates: 42,
      checked: 6,
      stoppedEarly: true,
    },
  );

  assert.match(text, /Geprüft: 6 von 42/);
  assert.match(text, /Zeitbudget erreicht/);
  assert.match(text, /Technisch in Ordnung: 2 · Mit Problem: 4/);
  assert.match(text, /HTTP 404/);
  assert.match(text, /noindex/);
  assert.match(text, /Canonical → https:\/\/example\.de\/original/);
  assert.match(text, /Zeitüberschreitung/);
  // Clean but uncrawled pages are listed separately, not as blockers.
  assert.match(text, /noch nicht in unserem Crawl-Index/);
  assert.match(text, /kein Google-Indexierungsstatus/);
  console.log("audit formatting: ok");
}

function testEmptyAudit() {
  const text = formatIndexabilityAudit([], {
    source: "crawl_index",
    sourceLabel: "Crawl-Index",
    totalCandidates: 0,
    checked: 0,
    stoppedEarly: false,
  });
  assert.match(text, /Keine URLs zum Prüfen/);
  console.log("empty audit: ok");
}

function testCleanAudit() {
  const text = formatIndexabilityAudit([row({}), row({ url: "https://example.de/zwei" })], {
    source: "sitemap",
    sourceLabel: "Sitemap https://example.de/sitemap.xml",
    totalCandidates: 2,
    checked: 2,
    stoppedEarly: false,
  });
  assert.match(text, /Keine technischen Blocker/);
  assert.doesNotMatch(text, /können so nicht ranken/);
  console.log("clean audit: ok");
}

testCanonicalEvaluation();
testAuditFormatting();
testEmptyAudit();
testCleanAudit();
console.log("All indexability audit tests passed.");
