/**
 * Workshop corpus: order, fingerprint, checklist, SEO text, saved summaries, plan input.
 * Run: npx tsx scripts/test-workshop-corpus.ts
 */
import "./support/stub-server-only";

import assert from "node:assert/strict";

import {
  AVATAR_QUICK_ACTIONS,
  avatarFirstName,
  buildProspectPrompt,
  containsInternalWorkshopNotes,
  dropInternalWorkshopParagraphs,
  avatarShortRole,
  ensureAvatarIntroducesSelf,
} from "../lib/dt/transcripts/avatar-value";
import { anbieterHasSavedPoints } from "../lib/dt/transcripts/anbieter-markdown";
import {
  isMarkdownTranscriptFilename,
  markdownDownloadName,
  resolveTranscriptReading,
  transcriptSummaryMarkdown,
} from "../lib/dt/transcripts/markdown-file";
import {
  ANBIETER_POINTS,
  buildCorpusPrompt,
  buildSummaryCorpusPrompt,
  buildCurrentAnbieterMarkdown,
  corpusFingerprint,
  describeAnbieterStand,
  formatRevisionBlock,
  normalizeAnbieterItems,
  normalizeAvatarPlan,
  normalizeDossier,
  forgetMissingAvatarAgents,
  isMissingAgentError,
  missingSummaryMessage,
  normalizePreview,
  orderWorkshopSources,
  readAnbieterState,
  readAvatarPlan,
  sectionStatus,
  sourcesWithoutSummary,
  type AnbieterItem,
  type WorkshopSource,
} from "../lib/dt/transcripts/workshop-model";
import type { WorkshopToolCall } from "../lib/dt/transcripts/avatar-plan-llm";
import {
  ANBIETER_GROUPS,
  ANBIETER_GROUP_TIMEOUT_MS,
  ANBIETER_REFILL_MAX_MS,
  WORKSHOP_TIMEOUT_MESSAGE,
  WorkshopTimeoutError,
  evaluateAnbieterCorpusWith,
  readWorkshopToolResult,
  workshopFailureMessage,
} from "../lib/dt/transcripts/workshop-llm";

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
            name: "Sabine Keller",
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
  assert.equal(stored.avatars[0]?.preview?.name, "Sabine");
  assert.match(stored.avatars[0]?.preview?.promptAppend ?? "", /^Ich heiße Sabine\./);
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

function testAvatarNameRoleAndQuickActions() {
  assert.equal(avatarFirstName("Thomas Berger"), "Thomas");
  assert.equal(avatarFirstName("lea"), "Lea");
  assert.equal(avatarFirstName("Geschäftsführer ohne eigene IT"), "");

  const longRole =
    "Geschäftsführer eines Unternehmens mit 20 bis 100 Mitarbeitern, ohne eigene IT-Abteilung";
  const short = avatarShortRole(longRole);
  assert.ok(short.length <= 72, short);
  assert.ok(short.split(/\s+/).length <= 6, short);
  assert.doesNotMatch(short, /[,:;–\-]$/);
  assert.equal(avatarShortRole("Geschäftsführer ohne eigene IT"), "Geschäftsführer ohne eigene IT");

  const body = `${"Du sprichst mit mir als Geschäftsführer. ".repeat(6)}Ich will Ruhe.`;
  const intro = ensureAvatarIntroducesSelf("Lea", body);
  assert.match(intro, /^Ich heiße Lea\./);
  assert.equal(ensureAvatarIntroducesSelf("Lea", intro), intro);

  const preview = normalizePreview({
    name: "Thomas Berger",
    role: longRole,
    summary: "Kurz",
    promptAppend: body,
  });
  assert.equal(preview?.name, "Thomas");
  assert.equal(preview?.role.split(/\s+/).length <= 6, true);
  assert.match(preview?.promptAppend ?? "", /^Ich heiße Thomas\./);
  assert.equal(
    normalizePreview({
      name: "Geschäftsführer ohne eigene IT",
      role: "Geschäftsführer ohne eigene IT",
      summary: "Kurz",
      promptAppend: body,
    }),
    null,
  );

  assert.equal(AVATAR_QUICK_ACTIONS.length, 5);
  assert.equal(AVATAR_QUICK_ACTIONS[0], "Stell dich bitte vor");
  assert.equal(
    AVATAR_QUICK_ACTIONS[1],
    "Wie bist du auf uns aufmerksam geworden und was bringt dich zu uns?",
  );
  assert.equal(AVATAR_QUICK_ACTIONS[2], "Was weißt du schon alles über uns?");
  assert.equal(AVATAR_QUICK_ACTIONS[3], "Wie kann ich dir helfen?");
  assert.equal(AVATAR_QUICK_ACTIONS[4], "Was erwartest du nach der Zusammenarbeit mit uns?");
  console.log("avatar name, role, quick actions: ok");
}

function testMissingAgentLink() {
  const live = "11111111-1111-4111-8111-111111111111";
  const gone = "22222222-2222-4222-8222-222222222222";
  const plan = {
    status: "approved" as const,
    sourceFingerprint: "abc",
    approvedFingerprint: "abc",
    revisionNote: "",
    notWanted: "",
    hinweis: "",
    avatars: [
      {
        key: "a",
        title: "Geschäftsführer ohne eigene IT",
        whySeparate: "",
        cases: [],
        generator: null,
        dossier: null,
        preview: null,
        agentId: gone,
      },
      {
        key: "b",
        title: "Zweiter",
        whySeparate: "",
        cases: [],
        generator: null,
        dossier: null,
        preview: null,
        agentId: live,
      },
    ],
  };
  const next = forgetMissingAvatarAgents(plan, new Set([live]));
  assert.equal(next.avatars[0]?.agentId, null);
  assert.equal(next.avatars[1]?.agentId, live);
  assert.equal(forgetMissingAvatarAgents(plan, new Set([live, gone])), plan);
  assert.equal(isMissingAgentError("agent_not_found"), true);
  assert.equal(isMissingAgentError("P0001: agent_not_found"), true);
  assert.equal(isMissingAgentError("forbidden"), false);
  console.log("missing agent link: ok");
}

testOrder();
testFingerprintAndStatus();
testChecklistAndSeoText();
testCorpusPrompt();
testAvatarRestore();
testValueFields();
testRevisionNote();
testAvatarNameRoleAndQuickActions();
function testAvatarPromptKeepsDossier() {
  const dossierDump = [
    "Aus der Anbieter-Persona: Wunschkundengröße 20–50.",
    "",
    "Nachgespräch: André fasst die Traumkunden auf 50 bis 90 zusammen. Premium-Segment, obere 20 Prozent.",
    "",
    "Ich weiß nicht, was es kostet. Red Dot ist seit über 10 Jahren Kunde, Bantek in Mülheim seit etwa 8 Jahren. Im Architekturbüro dauerte das Sicherheitsproblem 2 bis 3 Wochen.",
  ].join("\n");
  assert.equal(containsInternalWorkshopNotes(dossierDump), true);
  const spoken = dropInternalWorkshopParagraphs(dossierDump);
  assert.equal(spoken.includes("Nachgespräch"), false);
  assert.equal(spoken.includes("Premium-Segment"), false);
  assert.match(spoken, /Red Dot/);

  const prompt = buildProspectPrompt({
    name: "Stefan",
    title: "Geschäftsführer ohne eigene IT, etwa 20 bis 100 Mitarbeiter",
    body: spoken,
    quotes: ["Als langjähriger Kunde der IT Problemlöser können wir nur bestätigen, dass der Name Programm ist."],
    gaps: ["Genaue Anzahl der Betreuungsverträge"],
  });
  assert.match(prompt, /^Ich heiße Stefan\./);
  assert.match(prompt, /20 bis 100 Mitarbeiter/);
  assert.match(prompt, /Red Dot/);
  assert.match(prompt, /Mülheim/);
  assert.match(prompt, /Architekturbüro/);
  assert.match(prompt, /Name Programm ist/);
  assert.match(prompt, /Betreuungsverträge/);
  assert.equal(prompt.includes("Nachgespräch"), false);
  assert.equal(prompt.includes("Anbieter-Persona"), false);
  assert.equal(prompt.includes("50 bis 90"), false);
  console.log("avatar prompt keeps dossier: ok");
}

function testSavedSummaryReading() {
  // Pasted summary: source_kind "summary", no .md name, empty summary column → the body is the summary.
  const pasted = "Zusammenfassung Workshop: Festpreis pro Treppenhaus, Start nach zwei Wochen.";
  for (const filename of [null, "Notizen Workshop.txt"]) {
    for (const summary of [null, "", "   "]) {
      const reading = resolveTranscriptReading({ filename, sourceKind: "summary", summary, rawText: pasted });
      assert.equal(reading.sourceKind, "summary");
      assert.equal(reading.summary, pasted);
    }
  }
  // A saved summary column wins; a raw transcript without one stays without one.
  assert.equal(
    resolveTranscriptReading({ filename: null, sourceKind: "summary", summary: "Gespeichert", rawText: pasted }).summary,
    "Gespeichert",
  );
  assert.equal(
    resolveTranscriptReading({ filename: "call.txt", sourceKind: "raw", summary: null, rawText: "Wortlaut" }).summary,
    null,
  );

  assert.equal(markdownDownloadName("Müller & Söhne: Auftakt"), "mueller-soehne-auftakt.md");
  assert.equal(markdownDownloadName("   "), "zusammenfassung.md");
  assert.equal(
    transcriptSummaryMarkdown({ title: "Auftakt", filename: null, spokenOn: "2026-09-01", summary: "Festpreis.\n" }),
    "# Auftakt\n\nGespräch vom 01.09.2026\n\nFestpreis.\n",
  );
  console.log("saved summary reading: ok");
}

function testAnbieterSavedAt() {
  const savedAt = "2026-10-01T09:30:00.000Z";
  const stored = {
    sourceFingerprint: "old",
    approvedFingerprint: "old",
    revisionNote: "",
    savedAt,
    items: [
      { key: "unternehmen", label: "Unternehmen & Kern", current: "Malerbetrieb aus Mülheim" },
      { key: "preis", label: "Preis & Positionierung", current: "" },
    ],
  };
  // The Bestand changed since: the section is stale, the saved points and savedAt stay.
  const stale = readAnbieterState(stored, "new");
  assert.equal(stale.status, "stale");
  assert.equal(stale.savedAt, savedAt);
  assert.equal(anbieterHasSavedPoints(stale.items), true);
  assert.equal(stale.items.find((item) => item.key === "unternehmen")?.current, "Malerbetrieb aus Mülheim");
  assert.equal(stale.items.find((item) => item.key === "preis")?.current, "");
  const markdown = buildCurrentAnbieterMarkdown({ organisationName: "Malerei Hoffmann", items: stale.items });
  assert.match(markdown, /## Unternehmen & Kern\nMalerbetrieb aus Mülheim/);
  assert.match(markdown, /- Preis & Positionierung/);

  for (const status of ["approved", "proposed"] as const) {
    const state = readAnbieterState(
      { ...stored, approvedFingerprint: status === "approved" ? "old" : null },
      "old",
    );
    assert.equal(state.status, status);
    assert.equal(state.savedAt, savedAt);
    assert.equal(anbieterHasSavedPoints(state.items), true);
  }
  // Older rows without savedAt, or garbage, read as unknown.
  assert.equal(readAnbieterState({ ...stored, savedAt: undefined }, "old").savedAt, null);
  assert.equal(readAnbieterState({ ...stored, savedAt: "gestern" }, "old").savedAt, null);
  assert.equal(anbieterHasSavedPoints(normalizeAnbieterItems([])), false);
  console.log("anbieter savedAt + stale points: ok");
}

function testSummaryOnlyPlanInput() {
  const sources = [
    source({
      id: "late",
      spokenOn: "2026-09-20",
      title: "Folgegespräch",
      summary: "Hausverwaltungen wollen Festpreise.",
      rawText: "ROHTEXT-SPÄT Wortlaut",
    }),
    source({
      id: "early",
      spokenOn: "2026-09-01",
      title: "Auftakt",
      sourceKind: "summary",
      summary: "Privatkunden mit Altbau.",
      rawText: "Privatkunden mit Altbau.",
    }),
  ];
  const prompt = buildSummaryCorpusPrompt(sources, [
    { label: "Unternehmen & Kern", current: "Malerbetrieb aus Mülheim" },
    { label: "Preis & Positionierung", current: "" },
  ]);
  assert.ok(prompt.indexOf("Auftakt") < prompt.indexOf("Folgegespräch"));
  assert.match(prompt, /Privatkunden mit Altbau\./);
  assert.match(prompt, /Hausverwaltungen wollen Festpreise\./);
  assert.equal(prompt.includes("ROHTEXT-SPÄT"), false);
  assert.equal(prompt.includes("Wortlaut"), false);
  assert.match(prompt, /# Anbieterstand \(gespeicherte Punkte\)\n\n### Unternehmen & Kern\nMalerbetrieb aus Mülheim/);
  assert.equal(prompt.includes("Preis & Positionierung"), false);
  // Without Anbieter points no Anbieter section.
  assert.equal(buildSummaryCorpusPrompt(sources, []).includes("Anbieterstand"), false);

  // A raw conversation without a summary blocks, named in conversation order.
  const missing = sourcesWithoutSummary([
    ...sources,
    source({ id: "raw-b", spokenOn: "2026-09-25", title: "Telefonat", summary: null, rawText: "nur Wortlaut" }),
    source({ id: "raw-a", spokenOn: "2026-09-10", title: "Rundgang", summary: "  ", rawText: "nur Wortlaut" }),
  ]);
  assert.deepEqual(
    missing.map((item) => item.id),
    ["raw-a", "raw-b"],
  );
  assert.equal(
    missingSummaryMessage(missing),
    "Diese Gespräche haben noch keine Zusammenfassung: 10.09.2026 · Rundgang, 25.09.2026 · Telefonat. Bitte zuerst zusammenfassen.",
  );
  assert.deepEqual(sourcesWithoutSummary(sources), []);
  console.log("plan input uses summaries only: ok");
}

function testGeneratorStateRestore() {
  const stored = readAvatarPlan(
    {
      sourceFingerprint: "abc",
      approvedFingerprint: "abc",
      notWanted: "",
      hinweis: "Avatar 2 und 3 überschneiden sich beim Anlass.",
      avatars: [
        {
          key: "verwaltung",
          title: "Hausverwaltung mit mehreren Objekten",
          whySeparate: "",
          cases: [],
          generator: {
            status: "rueckfragen",
            rueckfragen: [{ block: "WER DU BIST", frage: "Soll ich 46 nehmen?", vorschlag: "46" }],
            antworten: [{ block: "ANREDE", frage: "Du oder Sie?", antwort: "Du" }],
            meta: null,
            errors: [],
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
          // An old Akte stays readable.
          dossier: { narrative: "Alte Akte" },
          agentId: null,
        },
      ],
    },
    "abc",
  );
  assert.equal(stored.hinweis, "Avatar 2 und 3 überschneiden sich beim Anlass.");
  assert.equal(stored.avatars[0]?.generator?.status, "rueckfragen");
  assert.equal(stored.avatars[0]?.generator?.rueckfragen[0]?.vorschlag, "46");
  assert.equal(stored.avatars[0]?.generator?.antworten[0]?.antwort, "Du");
  assert.equal(stored.avatars[0]?.dossier?.narrative, "Alte Akte");
  // A new plan keeps the generator state of an avatar with the same title.
  const replanned = normalizeAvatarPlan([{ title: "Hausverwaltung mit mehreren Objekten" }], stored.avatars);
  assert.equal(replanned[0]?.generator?.status, "rueckfragen");
  assert.equal(readAvatarPlan({}, "abc").hinweis, "");
  console.log("generator state restore: ok");
}

function toolMessage(input: Record<string, unknown>, stopReason: "tool_use" | "max_tokens" | null) {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "m",
    content: [{ type: "tool_use", id: "t", name: "submit_anbieter", input }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as never;
}

function testTimedOutCallThrows() {
  const partial = { unternehmen: "Versicherungsmakler", gruendung: "1990" };
  assert.throws(
    () => readWorkshopToolResult({ response: toolMessage(partial, null), model: "m", timedOut: true }, "submit_anbieter"),
    (err: Error) => err instanceof WorkshopTimeoutError && err.message === WORKSHOP_TIMEOUT_MESSAGE,
  );
  assert.match(WORKSHOP_TIMEOUT_MESSAGE, /^Die KI-Antwort wurde wegen Zeitüberschreitung abgebrochen/);
  // The route shows this message as it is, not the generic one.
  assert.equal(workshopFailureMessage(new WorkshopTimeoutError(), "x"), WORKSHOP_TIMEOUT_MESSAGE);
  assert.throws(
    () => readWorkshopToolResult({ response: toolMessage(partial, "max_tokens"), model: "m" }, "submit_anbieter"),
    /abgeschnitten/,
  );
  assert.throws(() => readWorkshopToolResult(null, "submit_anbieter"), /Kein verfügbares Modell/);
  const ok = readWorkshopToolResult({ response: toolMessage(partial, "tool_use"), model: "m" }, "submit_anbieter");
  assert.deepEqual(ok.json, partial);
  assert.deepEqual(ok.usage, { inputTokens: 10, outputTokens: 5 });
  console.log("timed-out call throws: ok");
}

type Call = Parameters<WorkshopToolCall>[0];

function schemaKeys(call: Call): string[] {
  return Object.keys((call.tool.input_schema as { properties: Record<string, unknown> }).properties);
}

/** Answers each key with `<key> text`, except the keys in `blank`. */
function answering(calls: Call[], blank: (call: Call, key: string) => boolean = () => false): WorkshopToolCall {
  return async (call) => {
    calls.push(call);
    const json = Object.fromEntries(schemaKeys(call).map((key) => [key, blank(call, key) ? "" : `${key} text`]));
    return { json, usage: { inputTokens: 100, outputTokens: 10 }, model: "m" };
  };
}

const corpusSources = [source({ id: "a", spokenOn: "2026-09-01", title: "Auftakt", summary: "Makler seit 1990." })];

async function testGroupsMergeIntoThirteen() {
  assert.deepEqual(
    ANBIETER_GROUPS.flat().slice().sort(),
    ANBIETER_POINTS.map((point) => point.key).slice().sort(),
  );
  assert.deepEqual(ANBIETER_GROUPS[0], ["unternehmen", "gruendung", "leistungen", "ablauf"]);
  assert.deepEqual(ANBIETER_GROUPS[2], ["sprache", "preis", "kanaele", "ziele"]);
  const calls: Call[] = [];
  const result = await evaluateAnbieterCorpusWith({
    organisationName: "Fischer Continentale",
    sources: corpusSources,
    call: answering(calls),
  });
  assert.equal(calls.length, 3);
  calls.forEach((call, index) => {
    assert.deepEqual(schemaKeys(call), ANBIETER_GROUPS[index]);
    assert.deepEqual((call.tool.input_schema as { required: string[] }).required, ANBIETER_GROUPS[index]);
    assert.equal(call.timeoutMs, ANBIETER_GROUP_TIMEOUT_MS);
    assert.match(call.user, /Makler seit 1990\./);
    assert.equal(call.user, calls[0]!.user);
    assert.match(call.system, /Nichts kürzen, nichts weglassen/);
    assert.match(call.system, new RegExp(`in die Felder ${ANBIETER_GROUPS[index]!.join(", ")}\\.`));
  });
  assert.equal(result.items.length, ANBIETER_POINTS.length);
  for (const item of result.items) assert.equal(item.current, `${item.key} text`);
  assert.deepEqual(result.usage, { inputTokens: 300, outputTokens: 30 });
  assert.equal(result.model, "m");

  // A group that writes outside its keys does not overwrite another group's point.
  const stray: WorkshopToolCall = async (call) => {
    const keys = schemaKeys(call);
    const json: Record<string, string> = Object.fromEntries(keys.map((key) => [key, `${key} text`]));
    if (keys.includes("sprache")) json.unternehmen = "falsch";
    return { json, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" };
  };
  const strayResult = await evaluateAnbieterCorpusWith({ organisationName: "X", sources: corpusSources, call: stray });
  assert.equal(strayResult.items.find((item) => item.key === "unternehmen")?.current, "unternehmen text");

  // One failed group fails the whole evaluation.
  const failing: WorkshopToolCall = async (call) => {
    if (schemaKeys(call).includes("preis")) throw new WorkshopTimeoutError();
    return { json: Object.fromEntries(schemaKeys(call).map((key) => [key, "x"])), usage: { inputTokens: 1, outputTokens: 1 }, model: "m" };
  };
  await assert.rejects(
    () => evaluateAnbieterCorpusWith({ organisationName: "X", sources: corpusSources, call: failing }),
    (err: Error) => err.message === WORKSHOP_TIMEOUT_MESSAGE,
  );
  console.log("three groups merge into 13 points: ok");
}

async function testRefillOnlyEmptyKeys() {
  const calls: Call[] = [];
  const blankInGroups = new Set(["gruendung", "preis", "ziele"]);
  const result = await evaluateAnbieterCorpusWith({
    organisationName: "X",
    sources: corpusSources,
    // Groups leave three points empty; the refill finds preis, ziele stays empty.
    call: answering(calls, (call, key) =>
      call.timeoutMs === ANBIETER_GROUP_TIMEOUT_MS ? blankInGroups.has(key) : key !== "preis",
    ),
  });
  assert.equal(calls.length, 4);
  const refill = calls[3]!;
  assert.deepEqual(schemaKeys(refill), ["gruendung", "preis", "ziele"]);
  assert.equal(refill.timeoutMs, ANBIETER_REFILL_MAX_MS);
  assert.equal(refill.user, calls[0]!.user);
  assert.match(refill.system, /Leer nur, wenn wirklich niemand etwas dazu gesagt hat\./);
  assert.match(refill.system, /Nichts kürzen, nichts weglassen/);
  const byKey = new Map(result.items.map((item) => [item.key, item.current]));
  assert.equal(byKey.get("preis"), "preis text");
  assert.equal(byKey.get("gruendung"), "");
  assert.equal(byKey.get("ziele"), "");
  assert.equal(byKey.get("unternehmen"), "unternehmen text");
  assert.deepEqual(result.usage, { inputTokens: 400, outputTokens: 40 });

  // No empty point: no refill.
  const full: Call[] = [];
  await evaluateAnbieterCorpusWith({ organisationName: "X", sources: corpusSources, call: answering(full) });
  assert.equal(full.length, 3);

  // Groups used up the time: the refill is skipped, the points stay empty.
  let clock = 0;
  const late: Call[] = [];
  const skipped = await evaluateAnbieterCorpusWith({
    organisationName: "X",
    sources: corpusSources,
    now: () => clock,
    call: async (call) => {
      clock = 270_000;
      return answering(late, (_call, key) => key === "preis")(call);
    },
  });
  assert.equal(late.length, 3);
  assert.equal(skipped.items.find((item) => item.key === "preis")?.current, "");

  // Less than the full refill time left: the refill gets only what is left.
  clock = 0;
  const tight: Call[] = [];
  await evaluateAnbieterCorpusWith({
    organisationName: "X",
    sources: corpusSources,
    now: () => clock,
    call: async (call) => {
      if (call.timeoutMs === ANBIETER_GROUP_TIMEOUT_MS) clock = 230_000;
      return answering(tight, (_call, key) => key === "preis")(call);
    },
  });
  assert.equal(tight.length, 4);
  assert.equal(tight[3]!.timeoutMs, 50_000);
  console.log("refill asks only for empty keys: ok");
}

async function testRevisionPassesGroupItems() {
  const currentItems: AnbieterItem[] = normalizeAnbieterItems({
    unternehmen: "Makler in Münchenheim",
    beweise: "Kunde Bantek",
    preis: "Stundenhonorar",
  });
  const calls: Call[] = [];
  await evaluateAnbieterCorpusWith({
    organisationName: "X",
    sources: corpusSources,
    instruction: "Der Sitz ist Mülheim.",
    currentItems,
    call: answering(calls),
  });
  const [first, second, third] = calls;
  for (const call of calls) {
    assert.match(call.user, /Der Sitz ist Mülheim\./);
    assert.match(call.system, /Liegt eine Anweisung bei/);
  }
  assert.match(first!.user, /Makler in Münchenheim/);
  assert.doesNotMatch(first!.user, /Bantek|Stundenhonorar/);
  assert.match(second!.user, /Kunde Bantek/);
  assert.doesNotMatch(second!.user, /Münchenheim|Stundenhonorar/);
  assert.match(third!.user, /Stundenhonorar/);
  assert.doesNotMatch(third!.user, /Münchenheim|Bantek/);

  // Without an instruction no revision block.
  const plain: Call[] = [];
  await evaluateAnbieterCorpusWith({ organisationName: "X", sources: corpusSources, call: answering(plain) });
  for (const call of plain) {
    assert.doesNotMatch(call.user, /Bisheriger Vorschlag|prüfenden Person/);
    assert.doesNotMatch(call.system, /Liegt eine Anweisung bei/);
  }
  console.log("revision passes the group's items: ok");
}

testMissingAgentLink();
testAvatarPromptKeepsDossier();
testSavedSummaryReading();
testAnbieterSavedAt();
testSummaryOnlyPlanInput();
testGeneratorStateRestore();
testTimedOutCallThrows();
void (async () => {
  await testGroupsMergeIntoThirteen();
  await testRefillOnlyEmptyKeys();
  await testRevisionPassesGroupItems();
  console.log("workshop corpus: all ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
