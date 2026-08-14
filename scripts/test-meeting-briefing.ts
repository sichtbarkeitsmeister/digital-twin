/**
 * Meeting briefing → Fragebogen prefills.
 * Run: npx tsx scripts/test-meeting-briefing.ts
 */
import assert from "node:assert/strict";

import {
  meetingBriefingHasContent,
  suggestPrefillsFromMeeting,
} from "../lib/surveys/meeting-briefing";

const empty = suggestPrefillsFromMeeting({
  briefing: {},
  hints: [
    { key: "competitors", hint: "competitors" },
    { key: "owner_name", hint: "owner_name" },
  ],
});
assert.equal(Object.keys(empty).length, 0);
assert.equal(meetingBriefingHasContent({}), false);

const prefills = suggestPrefillsFromMeeting({
  briefing: {
    legalCompanyName: "Musterdruck GmbH",
    ownerName: "Anna Druck",
    competitors: "Druckhaus Nord\nPrint24",
    goodCompetitors: "Onlineprinters",
    pagesOrLinks: "https://musterdruck.de/leistungen",
    notes: "Fokus auf Verpackungsdruck",
  },
  hints: [
    { key: "company_name", hint: "org_name" },
    { key: "owner_name", hint: "owner_name" },
    { key: "competitors", hint: "competitors" },
    { key: "good_competitors", hint: "good_competitors" },
  ],
});

assert.equal(prefills.company_name?.value, "Musterdruck GmbH");
assert.equal(prefills.company_name?.source, "meeting");
assert.equal(prefills.owner_name?.value, "Anna Druck");
assert.match(prefills.competitors?.value ?? "", /Druckhaus Nord/);
assert.equal(prefills.good_competitors?.value, "Onlineprinters");
assert.equal(meetingBriefingHasContent({ competitors: "x" }), true);

console.log("meeting-briefing: ok");
