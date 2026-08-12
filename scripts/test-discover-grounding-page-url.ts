/**
 * Grounding page URL discovery from website origin / footer / llms.txt.
 * Run: npx tsx scripts/test-discover-grounding-page-url.ts
 */
import assert from "node:assert/strict";

import {
  buildGroundingPageUrlCandidates,
  buildLlmsTxtUrlCandidates,
  extractGroundingUrlFromFooterHtml,
} from "../lib/dt/seo/discover-grounding-page-url";

const candidates = buildGroundingPageUrlCandidates("https://freiraumvier.de");
assert.ok(candidates.includes("https://freiraumvier.de/grounding/"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding-page/"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding-page"));

const withPath = buildGroundingPageUrlCandidates("https://freiraumvier.de/some/page");
assert.ok(withPath[0]?.startsWith("https://freiraumvier.de/grounding"));

assert.deepEqual(buildGroundingPageUrlCandidates(""), []);
assert.deepEqual(buildGroundingPageUrlCandidates("not-a-url"), []);

const llms = buildLlmsTxtUrlCandidates("https://freiraumvier.de");
assert.ok(llms.includes("https://freiraumvier.de/llms.txt"));
assert.ok(llms.includes("https://freiraumvier.de/.well-known/llms.txt"));

const footerHtml = `
<footer>
  <ul>
    <li><a href="/impressum/">Impressum</a></li>
    <li><a href="/datenschutzerklaerung/">Datenschutzerklärung</a></li>
    <li><a href="/privatsphaere/">Privatsphäre-Einstellungen ändern</a></li>
    <li><a href="/grounding/">Grounding</a></li>
  </ul>
</footer>
`;
assert.equal(
  extractGroundingUrlFromFooterHtml(footerHtml, "https://freiraumvier.de"),
  "https://freiraumvier.de/grounding/",
);

const noGrounding = `
<footer>
  <a href="/impressum/">Impressum</a>
  <a href="/datenschutz/">Datenschutz</a>
</footer>
`;
assert.equal(
  extractGroundingUrlFromFooterHtml(noGrounding, "https://example.de"),
  null,
);

console.log("discover-grounding-page-url tests: ok");
