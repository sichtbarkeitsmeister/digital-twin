/**
 * Erstgespräch / Kundendefinition mapping.
 * Run: npx tsx scripts/test-first-conversation.ts
 */
import assert from "node:assert/strict";

import {
  EMPTY_FIRST_CONVERSATION,
  FIRST_CONVERSATION_SECTIONS,
  firstConversationHasContent,
  firstConversationToMeetingBriefing,
  normalizeFirstConversation,
} from "../lib/surveys/first-conversation";
import {
  parseMeetingBriefingContent,
  suggestPrefillsFromMeeting,
} from "../lib/surveys/meeting-briefing";

assert.equal(firstConversationHasContent(EMPTY_FIRST_CONVERSATION), false);
assert.ok(FIRST_CONVERSATION_SECTIONS.length >= 5);

const record = normalizeFirstConversation({
  legalCompanyName: "Musterdruck GmbH",
  ownerName: "Anna Druck",
  ownerRole: "Inhaberin",
  region: "Hamm und 50km",
  usp: "Digitaler Zwilling",
  targetGroup: "Mittelstand mit eigenem Vertrieb",
  wunschkundeLabel: "Julia Schröder",
  industry: "Druckerei",
  competitors: "Druckhaus Nord",
  website: "https://musterdruck.de",
});

assert.equal(record.legalCompanyName, "Musterdruck GmbH");
assert.equal(firstConversationHasContent(record), true);

const briefing = firstConversationToMeetingBriefing(record);
assert.equal(briefing.legalCompanyName, "Musterdruck GmbH");
assert.equal(briefing.ownerName, "Anna Druck");
assert.equal(briefing.region, "Hamm und 50km");
assert.equal(briefing.usp, "Digitaler Zwilling");
assert.equal(briefing.website, "https://musterdruck.de");
assert.match(briefing.notes ?? "", /Branche/);
assert.match(briefing.notes ?? "", /Wunschkunde/);

const parsed = parseMeetingBriefingContent(briefing);
assert.equal(parsed.byHint.org_name, "Musterdruck GmbH");
assert.equal(parsed.byHint.owner_name, "Anna Druck");
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_industry"));
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_wunschkunde"));

const prefills = suggestPrefillsFromMeeting({
  briefing,
  hints: [
    { key: "company_name", hint: "org_name" },
    { key: "usp", hint: "usp" },
    { key: "competitors_top", hint: "competitors" },
  ],
});
assert.equal(prefills.company_name?.source, "meeting");
assert.match(prefills.usp?.value ?? "", /Zwilling/);
assert.match(prefills.competitors_top?.value ?? "", /Druckhaus Nord/);

console.log("first-conversation: ok");
