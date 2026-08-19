/**
 * Meeting briefing → Fragebogen prefills + split notes.
 * Run: npx tsx scripts/test-meeting-briefing.ts
 */
import assert from "node:assert/strict";

import {
  buildMeetingExtraQuestions,
  extractLabeledSections,
  meetingBriefingHasContent,
  parseMeetingBriefingContent,
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

const labeled = extractLabeledSections(`Region: Hamm und 50km Umgebung.
NRW
Bundesweit

USP: Einzigartiger Ansatz mit dem Digitalen Zwilling

Fokuskeywords: SEO Agentur Düsseldorf`);
assert.equal(labeled.length, 3);
assert.equal(labeled[0]?.label, "Region");
assert.match(labeled[0]?.value ?? "", /Hamm/);
assert.match(labeled[0]?.value ?? "", /Bundesweit/);
assert.equal(labeled[1]?.label, "USP");
assert.equal(labeled[2]?.label, "Fokuskeywords");

const parsed = parseMeetingBriefingContent({
  notes: `Region: Hamm und 50km Umgebung.
NRW
Bundesweit

USP: Einzigartiger Ansatz mit dem Digitalen Zwilling

Fokuskeywords: SEO Agentur Düsseldorf`,
  pagesOrLinks:
    "https://www.sichtbarkeitsmeister.de/kanzleimarketing/ Das hier ist deren zielgruppe, für die wir den fragebögen erstellen sollen.",
});

assert.match(parsed.byHint.region ?? "", /Hamm/);
assert.match(parsed.byHint.usp ?? "", /Digitalen Zwilling/);
assert.match(parsed.byHint.target_group ?? "", /fragebögen|Zielgruppe|zielgruppe/i);
assert.ok(parsed.pagesOrLinks?.includes("sichtbarkeitsmeister.de"));
assert.ok(
  parsed.extras.some((e) => e.id === "extra_meeting_focus_keywords"),
  "focus keywords as extra",
);
assert.ok(
  parsed.extras.some((e) => e.id === "extra_meeting_pages_links"),
  "pages links as extra",
);
assert.equal(
  parsed.extras.find((e) => e.id === "extra_meeting_focus_keywords")?.answer,
  "SEO Agentur Düsseldorf",
);

const extras = buildMeetingExtraQuestions({
  notes: `Region: Hamm
USP: Twin
Fokuskeywords: SEO Agentur Düsseldorf`,
});
assert.ok(!extras.some((e) => e.id === "extra_meeting_notes"), "no leftover dump");
assert.ok(extras.some((e) => e.id === "extra_meeting_focus_keywords"));

const fromNotesPrefill = suggestPrefillsFromMeeting({
  briefing: {
    notes: `Region: Hamm und 50km
USP: Digitaler Zwilling`,
  },
  hints: [
    { key: "region", hint: "region" },
    { key: "usp", hint: "usp" },
  ],
});
assert.match(fromNotesPrefill.region?.value ?? "", /Hamm/);
assert.match(fromNotesPrefill.usp?.value ?? "", /Zwilling/);

console.log("meeting-briefing: ok");
