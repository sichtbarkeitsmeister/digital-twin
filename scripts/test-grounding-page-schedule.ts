/**
 * Grounding page 3-month schedule helpers.
 * Run: npx tsx scripts/test-grounding-page-schedule.ts
 */
import assert from "node:assert/strict";

import {
  addUtcMonths,
  evaluateGroundingPageSchedule,
  GROUNDING_PAGE_WARN_DAYS,
} from "../lib/dt/seo/grounding-page-schedule";

const uploaded = "2026-01-15T12:00:00.000Z";
const due = addUtcMonths(uploaded, 3);
assert.equal(due.toISOString().slice(0, 10), "2026-04-15");

// End-of-month clamp: Jan 31 + 1 month → Feb 28 (2026 not leap for Feb... 2026 is not leap)
const jan31 = addUtcMonths("2026-01-31T12:00:00.000Z", 1);
assert.equal(jan31.toISOString().slice(0, 10), "2026-02-28");

const missing = evaluateGroundingPageSchedule({ uploadedAt: null });
assert.equal(missing.status, "missing");
assert.equal(missing.nextDueAt, null);

const ok = evaluateGroundingPageSchedule({
  uploadedAt: uploaded,
  now: "2026-02-01T12:00:00.000Z",
});
assert.equal(ok.status, "ok");
assert.ok((ok.daysUntilDue ?? 0) > GROUNDING_PAGE_WARN_DAYS);

const dueSoon = evaluateGroundingPageSchedule({
  uploadedAt: uploaded,
  now: "2026-04-05T12:00:00.000Z",
});
assert.equal(dueSoon.status, "due_soon");
assert.ok((dueSoon.daysUntilDue ?? 99) <= GROUNDING_PAGE_WARN_DAYS);
assert.ok((dueSoon.daysUntilDue ?? -1) >= 0);

const overdue = evaluateGroundingPageSchedule({
  uploadedAt: uploaded,
  now: "2026-04-20T12:00:00.000Z",
});
assert.equal(overdue.status, "overdue");
assert.ok((overdue.daysUntilDue ?? 1) < 0);

// Warn window starts exactly 14 days before due (Apr 1 for Apr 15)
const warnEdge = evaluateGroundingPageSchedule({
  uploadedAt: uploaded,
  now: "2026-04-01T12:00:00.000Z",
});
assert.equal(warnEdge.status, "due_soon");
assert.equal(warnEdge.daysUntilDue, 14);

const beforeWarn = evaluateGroundingPageSchedule({
  uploadedAt: uploaded,
  now: "2026-03-31T12:00:00.000Z",
});
assert.equal(beforeWarn.status, "ok");
assert.equal(beforeWarn.daysUntilDue, 15);

console.log("grounding-page-schedule tests: ok");
