/**
 * Grounding page URL discovery from website origin.
 * Run: npx tsx scripts/test-discover-grounding-page-url.ts
 */
import assert from "node:assert/strict";

import { buildGroundingPageUrlCandidates } from "../lib/dt/seo/discover-grounding-page-url";

const candidates = buildGroundingPageUrlCandidates("https://freiraumvier.de");
assert.ok(candidates.includes("https://freiraumvier.de/grounding/"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding-page/"));
assert.ok(candidates.includes("https://freiraumvier.de/grounding-page"));

const withPath = buildGroundingPageUrlCandidates("https://freiraumvier.de/some/page");
assert.ok(withPath[0]?.startsWith("https://freiraumvier.de/grounding"));

assert.deepEqual(buildGroundingPageUrlCandidates(""), []);
assert.deepEqual(buildGroundingPageUrlCandidates("not-a-url"), []);

console.log("discover-grounding-page-url tests: ok");
