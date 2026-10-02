/**
 * Workshop corpus: order, fingerprint, checklist, SEO text.
 * Run: npx tsx scripts/test-workshop-corpus.ts
 */
import assert from "node:assert/strict";

import {
  ANBIETER_POINTS,
  buildCorpusPrompt,
  buildCurrentAnbieterMarkdown,
  corpusFingerprint,
  normalizeAnbieterItems,
  normalizeAvatarPlan,
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
  assert.equal(items.find((item) => item.key === "unternehmen")?.current, "");
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
  assert.doesNotMatch(markdown, /darf nicht bleiben/);
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

testOrder();
testFingerprintAndStatus();
testChecklistAndSeoText();
testCorpusPrompt();
testAvatarRestore();
console.log("workshop corpus: all ok");
