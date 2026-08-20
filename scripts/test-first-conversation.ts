/**
 * Erstgespräch / Kundendefinition mapping.
 * Run: npx tsx scripts/test-first-conversation.ts
 */
import assert from "node:assert/strict";

import {
  EMPTY_FIRST_CONVERSATION,
  FIRST_CONVERSATION_KIND_TABS,
  applyDocumentTextToFirstConversation,
  firstConversationHasContent,
  firstConversationKindOf,
  firstConversationSectionsForKind,
  firstConversationToMeetingBriefing,
  firstConversationVisibleKeys,
  normalizeFirstConversation,
  prepareFirstConversationForSave,
} from "../lib/surveys/first-conversation";
import {
  parseMeetingBriefingContent,
  suggestPrefillsFromMeeting,
} from "../lib/surveys/meeting-briefing";

assert.equal(firstConversationHasContent(EMPTY_FIRST_CONVERSATION), false);
assert.equal(FIRST_CONVERSATION_KIND_TABS.length, 3);
assert.deepEqual(
  FIRST_CONVERSATION_KIND_TABS.map((tab) => tab.id),
  ["praxis", "kanzlei", "weitere"],
);

const praxisSections = firstConversationSectionsForKind("praxis");
const kanzleiSections = firstConversationSectionsForKind("kanzlei");
const weitereSections = firstConversationSectionsForKind("weitere");
assert.ok(praxisSections.length >= 6);
assert.equal(praxisSections.length, kanzleiSections.length);
assert.equal(praxisSections.length, weitereSections.length);

const praxisAsks = praxisSections.flatMap((section) =>
  section.fields.flatMap((field) => [field.label, field.ask]),
);
const kanzleiAsks = kanzleiSections.flatMap((section) =>
  section.fields.flatMap((field) => [field.label, field.ask]),
);
const weitereAsks = weitereSections.flatMap((section) =>
  section.fields.flatMap((field) => [field.label, field.ask]),
);
assert.ok(praxisAsks.some((text) => /Patienten/.test(text)));
assert.ok(praxisAsks.some((text) => /Wunschpatient/.test(text)));
assert.ok(kanzleiAsks.some((text) => /Mandanten/.test(text)));
assert.ok(kanzleiAsks.some((text) => /Wunschmandant/.test(text)));
assert.ok(weitereAsks.some((text) => /Kunden/.test(text)));
assert.ok(weitereAsks.some((text) => /Wunschkunde/.test(text)));

const praxisKeys = firstConversationVisibleKeys("praxis");
const kanzleiKeys = firstConversationVisibleKeys("kanzlei");
const weitereKeys = firstConversationVisibleKeys("weitere");
assert.ok(praxisKeys.includes("competitors"));
assert.ok(!praxisKeys.includes("goodCompetitors"));
assert.ok(!kanzleiKeys.includes("goodCompetitors"));
assert.ok(!praxisKeys.includes("industry"));
assert.ok(!kanzleiKeys.includes("industry"));
assert.ok(weitereKeys.includes("industry"));
assert.ok(praxisKeys.includes("currentStatus"));
assert.ok(praxisKeys.includes("futurePlans"));
assert.ok(praxisKeys.includes("wunschkundeLabel"));
assert.equal(praxisSections.filter((section) => section.id === "visibility").length, 1);
assert.equal(
  praxisSections.find((section) => section.id === "visibility")?.fields.length,
  1,
);

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
  goodCompetitors: "Onlineprinters",
  website: "https://musterdruck.de",
  currentStatus: "Auftragslage gut, Sichtbarkeit hakt",
  futurePlans: "Neue Landingpage, Newsletter",
});

assert.equal(record.legalCompanyName, "Musterdruck GmbH");
assert.equal(firstConversationHasContent(record), true);
assert.equal(firstConversationKindOf(record), "weitere");

const briefing = firstConversationToMeetingBriefing(record);
assert.equal(briefing.legalCompanyName, "Musterdruck GmbH");
assert.equal(briefing.ownerName, "Anna Druck");
assert.equal(briefing.region, "Hamm und 50km");
assert.equal(briefing.usp, "Digitaler Zwilling");
assert.equal(briefing.website, "https://musterdruck.de");
assert.match(briefing.competitors ?? "", /Druckhaus Nord/);
assert.match(briefing.competitors ?? "", /Onlineprinters/);
assert.equal(briefing.goodCompetitors, "Onlineprinters");
assert.match(briefing.notes ?? "", /Branche/);
assert.match(briefing.notes ?? "", /Wunschkunde/);
assert.match(briefing.notes ?? "", /Aktueller Stand/);
assert.match(briefing.notes ?? "", /Zukunft/);

const parsed = parseMeetingBriefingContent(briefing);
assert.equal(parsed.byHint.org_name, "Musterdruck GmbH");
assert.equal(parsed.byHint.owner_name, "Anna Druck");
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_industry"));
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_wunschkunde"));
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_current_status"));
assert.ok(parsed.extras.some((e) => e.id === "extra_meeting_future_plans"));

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

const fromDoc = applyDocumentTextToFirstConversation(EMPTY_FIRST_CONVERSATION, `Firmenname: Musterdruck GmbH
Region: Hamm
USP: Digitaler Zwilling
Aktueller Stand: Läuft gut
Zukunft: Newsletter`);
assert.equal(fromDoc.record.legalCompanyName, "Musterdruck GmbH");
assert.equal(fromDoc.record.region, "Hamm");
assert.equal(fromDoc.record.currentStatus, "Läuft gut");
assert.equal(fromDoc.record.futurePlans, "Newsletter");
assert.ok(fromDoc.filledKeys.includes("legalCompanyName"));

const kept = applyDocumentTextToFirstConversation(
  { ...EMPTY_FIRST_CONVERSATION, legalCompanyName: "Bleibt" },
  "Firmenname: Neu GmbH",
);
assert.equal(kept.record.legalCompanyName, "Bleibt");

const praxisSave = prepareFirstConversationForSave({
  ...EMPTY_FIRST_CONVERSATION,
  conversationKind: "praxis",
  legalCompanyName: "Haut- und Laserpraxis",
  currentStatus: "Läuft gut",
});
assert.equal(praxisSave.conversationKind, "praxis");
assert.equal(praxisSave.industry, "Arztpraxis");

const kanzleiFromIndustry = normalizeFirstConversation({
  industry: "Fachanwaltskanzlei",
  legalCompanyName: "Müller Rechtsanwälte",
});
assert.equal(kanzleiFromIndustry.conversationKind, "");
assert.equal(firstConversationKindOf(kanzleiFromIndustry), "kanzlei");
assert.equal(
  prepareFirstConversationForSave(kanzleiFromIndustry).conversationKind,
  "kanzlei",
);

const switched = {
  ...record,
  conversationKind: "kanzlei" as const,
};
assert.equal(switched.legalCompanyName, "Musterdruck GmbH");
assert.equal(firstConversationKindOf(switched), "kanzlei");

console.log("first-conversation: ok");
