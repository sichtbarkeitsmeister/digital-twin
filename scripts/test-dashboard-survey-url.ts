/**
 * Dashboard survey URLs must load the questionnaire, not public HTML.
 * Run: npx tsx scripts/test-dashboard-survey-url.ts
 */
import assert from "node:assert/strict";

import { extractUrlsFromText } from "../lib/shared/pasted-url-context";
import {
  extractDashboardSurveyIdFromUrl,
  extractDashboardSurveyIdsFromText,
  isDashboardSurveyAppUrl,
} from "../lib/surveys/dashboard-survey-url";

const westId = "da79cd08-3520-4db0-bf41-d456841e6d95";
const editUrl = `https://www.digital-twin-sbkm.de/dashboard/surveys/${westId}/edit`;

assert.equal(extractDashboardSurveyIdFromUrl(editUrl), westId);
assert.equal(
  extractDashboardSurveyIdFromUrl(`/dashboard/surveys/${westId}/responses`),
  westId,
);
assert.equal(extractDashboardSurveyIdFromUrl("https://westpruefung-anwaelte.de/"), null);
assert.equal(isDashboardSurveyAppUrl(editUrl), true);
assert.equal(isDashboardSurveyAppUrl("https://example.com/about"), false);

assert.deepEqual(
  extractDashboardSurveyIdsFromText(
    `hier kannst du doch einsehen, wie der stand ist\n${editUrl}`,
  ),
  [westId],
);

assert.deepEqual(extractUrlsFromText(editUrl), []);
assert.ok(
  extractUrlsFromText("Bitte https://westpruefung-anwaelte.de/kontakt prüfen").includes(
    "https://westpruefung-anwaelte.de/kontakt",
  ),
);

console.log("ok: dashboard survey url");
