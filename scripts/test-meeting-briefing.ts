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

const kickoff = `Kickoff-Meeting:
Wunschpatienten (Haut- und Laserpraxis Dr. Schürings, Meerbusch)
Legende:
✅ Beantwortet im Meeting

Kurzer Kontext zur Praxis
    • Praxis wurde umbenannt in "Haut- und Laserpraxis" – dieser neue Name ist auf der Website aktuell noch nicht sichtbar (steht dort weiterhin "Dr. Schürings Dermatologie").
    • Dr. Schürings ist internationale Expertin für Fotona-Laser und die Praxis ist Schulungszentrum für andere Ärzte.
    • Die Praxis behandelt keine gesetzlich Versicherten in diesem Sinne.
    • Es gibt eine Kosmetikerin, die in der Praxis mitarbeitet – ihr Angebot fehlt aktuell komplett auf der Website.

    • ✅ Wie läuft die Praxis aktuell?
 Läuft gut. Aufteilung ca. 50 % Selbstzahler / 50 % Privatpatienten.
    • ✅ Welche Patienten sind ihr am liebsten?
Privatpatienten, die regelmäßig (etwa alle 1–2 Monate) kommen – Hautkrebsvorsorge als Anlass.
    • ✅ Welche Patienten sind eher unattraktiv?
Selbstzahler, die nur mit einer kleinen Einzelleistung kommen (z. B. Ausschlag + Creme, einmalig).
    • ✅ Wo möchte sie wachsen?
Laser-Behandlungen und größere Eingriffe wie Lipome und Atherome.
    • ✅ Standort:
Ein Standort in Meerbusch, keine weiteren Standorte geplant.
    • ✅ Zwei Wunschkunden-Typen final festgelegt:
        1. Privatpatient mit Hautkrebsvorsorge als Anker
        2. Laser-Interessent
    • ✅ Buchungsweg:
Termine werden online über Doctolib oder telefonisch gebucht. 🔍 Details zur Rezeptions-/Rückruf-Prozessplanung wurden nicht vollständig geklärt – ggf. im Fragebogen oder Folgegespräch vertiefen. Block 1 – Praxis & Patientengruppen (Wunschkunden-Definition)
    • ✅ Ansprechpartnerin:
Dr. Schürings selbst ist direkte Ansprechpartnerin für die laufende Abstimmung.

Das Kickoff hat am 19.08.2026 stattgefunden. Diese Version ist dieZusammenfassung: beantwortete Punkte sind markiert.
Medizinische Dermatologie:
Hautkrebsvorsorge (inkl. KI-gestützter Diagnostik), Akne-Behandlung, Ekzeme
Ästhetische Medizin:
Botulinumtoxin/Faltenbehandlung, Migräne-Behandlung
Laserbehandlungen:
dauerhafte Haarentfernung, Tattooentfernung, Fotona4D`;

const kickoffParsed = parseMeetingBriefingContent({ notes: kickoff });
assert.match(kickoffParsed.byHint.region ?? "", /Meerbusch/);
assert.match(kickoffParsed.byHint.online_channels ?? "", /Doctolib/);
assert.match(kickoffParsed.byHint.typical_process ?? "", /Doctolib|telefon/i);
assert.equal(/Block 1|Wunschkunden-Definition|ggf\. im Fragebogen/.test(kickoffParsed.byHint.typical_process ?? ""), false);
assert.match(kickoffParsed.byHint.no_fit ?? "", /Selbstzahler|gesetzlich/i);
assert.match(kickoffParsed.byHint.target_group ?? "", /Privatpatient|Laser/i);
assert.equal(kickoffParsed.byHint.owner_name, "Dr. Schürings");
assert.equal(/Ansprechpartnerin für die laufende/.test(kickoffParsed.byHint.owner_name ?? ""), false);
assert.equal(/KI-Sprachassistent|Block 1|Rezeption/.test(kickoffParsed.byHint.online_channels ?? ""), false);
assert.match(kickoffParsed.byHint.online_channels ?? "", /Doctolib/);
assert.equal(/^\.|gemac$|^ionale/.test(kickoffParsed.byHint.usp ?? ""), false);
assert.match(kickoffParsed.byHint.usp ?? "", /Schulungszentrum|Fotona/i);
assert.match(kickoffParsed.byHint.services ?? "", /Hautkrebsvorsorge|Akne/i);
assert.equal(
  kickoffParsed.extras.some((e) => /zusammenfassung|medizinische dermatologie|kickoff hat am/i.test(e.title)),
  false,
);

const kickoffExtras = buildMeetingExtraQuestions({ notes: kickoff });
assert.equal(
  kickoffExtras.some((e) => e.id === "extra_meeting_notes" && /beantwortet im meeting/i.test(e.answer)),
  false,
);
assert.match(kickoffParsed.byHint.org_name ?? "", /Haut- und Laserpraxis/);
assert.match(kickoffParsed.byHint.colloquial_name ?? "", /Dermatologie/);
assert.match(kickoffParsed.byHint.usp ?? "", /Schulungszentrum|Fotona/i);
assert.equal(/Kurzer Kontext|Welche Patienten sind ihr am liebsten/.test(kickoffParsed.byHint.company_history ?? ""), false);
assert.match(kickoffParsed.byHint.company_history ?? "", /Haut- und Laserpraxis/);
assert.match(kickoffParsed.byHint.company_history ?? "", /Schürings Dermatologie/);
assert.equal(/Welche Patienten sind ihr am liebsten/.test(kickoffParsed.byHint.why_stay ?? ""), false);
assert.match(kickoffParsed.byHint.why_stay ?? "", /Privatpatienten, die regelmäßig/);

const kickoffPrefills = suggestPrefillsFromMeeting({
  briefing: { notes: kickoff },
  hints: [
    { key: "location_catchment", hint: "region" },
    { key: "online_channels", hint: "online_channels" },
    { key: "typical_process", hint: "typical_process" },
    { key: "no_fit_clients", hint: "no_fit" },
    { key: "company_name", hint: "org_name" },
    { key: "usp", hint: "usp" },
    { key: "respondent_name", hint: "owner_name" },
    { key: "team_members", hint: "team_members" },
    { key: "portfolio", hint: "services" },
  ],
});
assert.equal(kickoffPrefills.location_catchment?.source, "meeting");
assert.match(kickoffPrefills.location_catchment?.value ?? "", /Meerbusch/);
assert.match(kickoffPrefills.online_channels?.value ?? "", /Doctolib/);
assert.equal(kickoffPrefills.respondent_name?.value, "Dr. Schürings");
assert.match(kickoffPrefills.portfolio?.value ?? "", /Hautkrebsvorsorge|Akne/i);
assert.match(kickoffPrefills.no_fit_clients?.value ?? "", /Selbstzahler|gesetzlich/i);
assert.match(kickoffPrefills.company_name?.value ?? "", /Haut- und Laserpraxis/);

console.log("meeting-briefing: ok");
