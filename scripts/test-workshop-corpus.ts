/**
 * Workshop corpus: order, fingerprint, checklist, SEO text.
 * Run: npx tsx scripts/test-workshop-corpus.ts
 */
import assert from "node:assert/strict";

import {
  isMarkdownTranscriptFilename,
  resolveTranscriptReading,
} from "../lib/dt/transcripts/markdown-file";
import {
  ANBIETER_POINTS,
  buildCorpusPrompt,
  buildCurrentAnbieterMarkdown,
  corpusFingerprint,
  describeAnbieterStand,
  formatRevisionBlock,
  normalizeAnbieterItems,
  normalizeAvatarPlan,
  normalizeDossier,
  orderWorkshopSources,
  readAnbieterState,
  readAvatarPlan,
  sectionStatus,
  type WorkshopSource,
} from "../lib/dt/transcripts/workshop-model";

function source(partial: Partial<WorkshopSource> & Pick<WorkshopSource, "id">): WorkshopSource {
  return {
    title: partial.title ?? partial.id,
    filename: partial.filename ?? null,
    sourceKind: partial.sourceKind ?? "raw",
    spokenOn: partial.spokenOn ?? null,
    createdAt: partial.createdAt ?? "2026-09-01T10:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-09-01T10:00:00.000Z",
    summary: partial.summary ?? null,
    rawText: partial.rawText ?? "Wortlaut",
    id: partial.id,
  };
}

function testOrder() {
  const ordered = orderWorkshopSources([
    source({ id: "b", spokenOn: "2026-09-20", createdAt: "2026-09-21T10:00:00.000Z" }),
    source({ id: "c", spokenOn: null, createdAt: "2026-09-01T10:00:00.000Z" }),
    source({ id: "a", spokenOn: "2026-09-01", createdAt: "2026-09-02T10:00:00.000Z" }),
    source({
      id: "a2",
      spokenOn: "2026-09-01",
      createdAt: "2026-09-01T08:00:00.000Z",
    }),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["a2", "a", "b", "c"],
  );
  console.log("order: ok");
}

function testFingerprintAndStatus() {
  const first = [
    source({ id: "a", spokenOn: "2026-09-01", summary: "erste Fassung", rawText: "abc" }),
  ];
  const changed = [
    source({ id: "a", spokenOn: "2026-09-01", summary: "spätere Fassung", rawText: "abc" }),
  ];
  const hash = corpusFingerprint(first);
  const next = corpusFingerprint(changed);
  assert.notEqual(hash, next);
  assert.equal(
    sectionStatus({
      fingerprint: hash,
      sourceFingerprint: null,
      approvedFingerprint: null,
      hasContent: false,
    }),
    "empty",
  );
  assert.equal(
    sectionStatus({
      fingerprint: hash,
      sourceFingerprint: hash,
      approvedFingerprint: null,
      hasContent: true,
    }),
    "proposed",
  );
  assert.equal(
    sectionStatus({
      fingerprint: hash,
      sourceFingerprint: hash,
      approvedFingerprint: hash,
      hasContent: true,
    }),
    "approved",
  );
  assert.equal(
    sectionStatus({
      fingerprint: next,
      sourceFingerprint: hash,
      approvedFingerprint: hash,
      hasContent: true,
    }),
    "stale",
  );
  console.log("fingerprint + status: ok");
}

function testChecklistAndSeoText() {
  const items = normalizeAnbieterItems([
    { key: "leistungen", current: "Lohn und Jahresabschluss", earlier: "nur Lohn", sources: "01.09. dann 20.09." },
    { key: "erfunden", current: "darf nicht bleiben" },
    { key: "preis", current: "", earlier: "alt" },
  ]);
  assert.equal(items.length, ANBIETER_POINTS.length);
  assert.equal(items.find((item) => item.key === "leistungen")?.earlier, "nur Lohn");
  assert.equal(items.some((item) => item.key === ("erfunden" as "preis")), false);
  assert.equal(items.find((item) => item.key === "unternehmen")?.current, "darf nicht bleiben");
  const byLabel = normalizeAnbieterItems({
    items: [{ key: "Leistungen & Schwerpunkte", current: "Lohn" }],
  });
  assert.equal(byLabel.find((item) => item.key === "leistungen")?.current, "Lohn");
  const flat = normalizeAnbieterItems({
    leistungen: "Lohn und Abschluss",
    "Unternehmen & Kern": { text: "IT-Problemlöser" },
  });
  assert.equal(flat.find((item) => item.key === "leistungen")?.current, "Lohn und Abschluss");
  assert.match(flat.find((item) => item.key === "unternehmen")?.current ?? "", /Problemlöser/);
  const nested = normalizeAnbieterItems({
    items: [{ punkt: "Leistungen", inhalt: { text: "Lohn und Jahresabschluss" } }],
    markdown: "## Preis & Positionierung\nFestpreis ab 2.000 Euro.",
  });
  assert.match(nested.find((item) => item.key === "leistungen")?.current ?? "", /Jahresabschluss/);
  assert.match(nested.find((item) => item.key === "preis")?.current ?? "", /2\.000 Euro/);
  const blob = normalizeAnbieterItems({
    content: "Die Kanzlei macht Lohn, Jahresabschluss und Beratung für Pflegeheime.",
  });
  assert.match(blob.find((item) => item.key === "unternehmen")?.current ?? "", /Pflegeheime/);
  const ablauf = normalizeAnbieterItems({
    markdown: "## Ablauf & Mitwirkung\nErstgespräch in wenigen Tagen, Konzept in ein bis zwei Wochen.",
  });
  assert.match(ablauf.find((item) => item.key === "ablauf")?.current ?? "", /ein bis zwei Wochen/);
  const fromList = readAnbieterState(
    {
      sourceFingerprint: "abc",
      items: [{ key: "leistungen", current: ["Lohn", "Jahresabschluss"] }],
    },
    "abc",
  );
  assert.equal(fromList.status, "proposed");
  assert.match(fromList.items.find((item) => item.key === "leistungen")?.current ?? "", /Jahresabschluss/);

  const markdown = buildCurrentAnbieterMarkdown({
    organisationName: "Westprüfung",
    items,
  });
  assert.match(markdown, /Lohn und Jahresabschluss/);
  assert.doesNotMatch(markdown, /nur Lohn/);
  assert.match(markdown, /Noch offen/);
  assert.match(markdown, /Nicht erfinden/);
  assert.match(markdown, /Unternehmen & Kern/);
  assert.match(markdown, /darf nicht bleiben/);
  console.log("checklist + seo text: ok");
}

function testCorpusPrompt() {
  const prompt = buildCorpusPrompt(
    [
      source({
        id: "late",
        spokenOn: "2026-09-20",
        title: "Folgegespräch",
        summary: "Preis ist Festpreis.",
        rawText: "Wir nehmen einen Festpreis.",
      }),
      source({
        id: "early",
        spokenOn: "2026-09-01",
        title: "Auftakt",
        summary: "Preis ist Stundenhonorar.",
        rawText: "Wir rechnen nach Stunden ab.",
        sourceKind: "raw",
      }),
    ],
    { rawChars: 100 },
  );
  const early = prompt.indexOf("Auftakt");
  const late = prompt.indexOf("Folgegespräch");
  assert.ok(early >= 0 && late > early);
  assert.ok(prompt.indexOf("Zusammenfassung") < prompt.indexOf("Wir rechnen nach Stunden ab."));
  const long = `${"Wort ".repeat(2_000)}ENDE`;
  const full = buildCorpusPrompt([
    source({ id: "full", spokenOn: "2026-09-01", rawText: long, summary: null }),
  ]);
  assert.ok(full.includes("ENDE"));
  assert.equal(full.includes("gekürzt"), false);

  assert.equal(
    isMarkdownTranscriptFilename("Zusammenfassung_Anbieter-Persona_IT_Problemloeser.md"),
    true,
  );
  assert.equal(isMarkdownTranscriptFilename("Transcript_Teil_1.txt"), false);
  const markdownBody = `# Anbieter\n\n${"Satz ".repeat(400)}ENDE der Zusammenfassung`;
  const reading = resolveTranscriptReading({
    filename: "Zusammenfassung_Anbieter-Persona_IT_Problemloeser.md",
    sourceKind: "raw",
    summary: null,
    rawText: markdownBody,
  });
  assert.equal(reading.sourceKind, "summary");
  assert.equal(reading.summary, markdownBody);
  const markdownPrompt = buildCorpusPrompt([
    source({
      id: "md",
      filename: "Zusammenfassung_Anbieter-Persona_IT_Problemloeser.md",
      sourceKind: reading.sourceKind,
      summary: reading.summary,
      rawText: markdownBody,
    }),
  ]);
  assert.ok(markdownPrompt.includes("### Zusammenfassung"));
  assert.ok(markdownPrompt.includes("ENDE der Zusammenfassung"));
  assert.equal(markdownPrompt.includes("### Wortlaut"), false);
  assert.equal(markdownPrompt.includes("gekürzt"), false);
  console.log("corpus prompt: ok");
}

function testAvatarRestore() {
  const previous = normalizeAvatarPlan(
    [{ key: "leitung", title: "Leitung Pflegeheim", whySeparate: "andere Worte" }],
    [],
  );
  previous[0] = {
    ...previous[0]!,
    dossier: {
      narrative: "Akte bleibt.",
      schmerz: "Fristen",
      traumergebnis: "Ruhe",
      dringlichkeit: "",
      huerde: "Preis unklar",
      aufwand: "Unterlagen schicken",
      zeit: "Erstgespräch, dann zwei Wochen",
      wahrscheinlichkeit: "Empfehlung der Nachbarin",
      pains: "Fristen",
      outcome: "Ruhe",
      quotes: ["Bitte ohne Fachchinesisch."],
      gaps: ["Preis"],
    },
    agentId: "agent-1",
  };
  const next = normalizeAvatarPlan(
    [{ title: "Leitung Pflegeheim", whySeparate: "andere Worte", cases: [] }],
    previous,
  );
  assert.equal(next[0]?.dossier?.narrative, "Akte bleibt.");
  assert.equal(next[0]?.agentId, "agent-1");

  const stored = readAvatarPlan(
    {
      sourceFingerprint: "abc",
      approvedFingerprint: "abc",
      notWanted: "Konzerne",
      avatars: [
        {
          key: next[0]?.key,
          title: "Leitung Pflegeheim",
          whySeparate: "andere Worte",
          cases: [],
          dossier: previous[0]?.dossier,
          preview: {
            name: "Leitung Pflegeheim",
            role: "Einrichtungsleitung",
            summary: "Will Fristen im Blick.",
            promptAppend: "Ich leite ein Pflegeheim und will klare Worte. ".repeat(4),
          },
          agentId: "agent-1",
        },
      ],
    },
    "abc",
  );
  assert.equal(stored.status, "approved");
  assert.equal(stored.avatars[0]?.preview?.name, "Leitung Pflegeheim");
  assert.equal(stored.avatars[0]?.agentId, "agent-1");
  assert.equal(stored.notWanted, "Konzerne");
  console.log("avatar restore: ok");
}

function testRevisionNote() {
  const block = formatRevisionBlock(
    "Bantek liegt in Mülheim. Endphone streichen.",
    describeAnbieterStand([
      {
        key: "beweise",
        label: "Beweise & Erfolge",
        current: "Bantek in Münchenheim. Früher Endphone.",
        earlier: null,
        sources: "",
      },
    ]),
  );
  assert.match(block, /prüfenden Person/);
  assert.match(block, /Mülheim/);
  assert.match(block, /Bisheriger Vorschlag/);
  assert.match(block, /Münchenheim/);
  assert.equal(formatRevisionBlock("   ", "Stand"), "");

  const stored = readAnbieterState(
    {
      sourceFingerprint: "abc",
      approvedFingerprint: null,
      revisionNote: "Ort korrigieren",
      items: [{ key: "leistungen", current: "Betreuung" }],
    },
    "abc",
  );
  assert.equal(stored.revisionNote, "Ort korrigieren");
  assert.equal(stored.status, "proposed");
  console.log("revision note: ok");
}

function testValueFields() {
  const legacy = normalizeDossier({
    narrative: "Der Kunde will Ruhe.",
    pains: "Nichts wird fertig.",
    outcome: "Endlich läuft es.",
    quotes: ["Wir sind seit Ewigkeiten unzufrieden."],
    gaps: ["Zahl der Kunden"],
  });
  assert.equal(legacy?.schmerz, "Nichts wird fertig.");
  assert.equal(legacy?.traumergebnis, "Endlich läuft es.");
  assert.equal(legacy?.pains, legacy?.schmerz);
  assert.equal(legacy?.dringlichkeit, "");
  assert.equal(legacy?.huerde, "");
  assert.deepEqual(legacy?.gaps, ["Zahl der Kunden"]);

  const fresh = normalizeDossier({
    narrative: "Belege bleiben vollständig.",
    schmerz: "Der alte Anbieter meldet sich nicht.",
    traumergebnis: "Ich muss nicht mehr wechseln.",
    dringlichkeit: "",
    huerde: "Ich weiß nicht, was es kostet.",
    aufwand: "Ich muss die Zugänge besorgen.",
    zeit: "Termin in wenigen Tagen, spürbar nach zwei Wochen.",
    wahrscheinlichkeit: "Kunden bleiben länger als zehn Jahre.",
    quotes: [],
    gaps: ["Einstieg beim Verein"],
  });
  assert.equal(fresh?.aufwand, "Ich muss die Zugänge besorgen.");
  assert.equal(fresh?.dringlichkeit, "");
  assert.match(fresh?.narrative ?? "", /vollständig/);

  const empty = normalizeDossier({ narrative: "   ", schmerz: "", quotes: [], gaps: [] });
  assert.equal(empty, null);
  console.log("value fields: ok");
}

testOrder();
testFingerprintAndStatus();
testChecklistAndSeoText();
testCorpusPrompt();
testAvatarRestore();
testValueFields();
testRevisionNote();
console.log("workshop corpus: all ok");
