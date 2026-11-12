/**
 * Workshop corpus: order, fingerprint, checklist, SEO text, saved summaries, plan input.
 * Run: npx tsx scripts/test-workshop-corpus.ts
 */
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

testMissingAgentLink();
testAvatarPromptKeepsDossier();
testSavedSummaryReading();
testAnbieterSavedAt();
testSummaryOnlyPlanInput();
testGeneratorStateRestore();
console.log("workshop corpus: all ok");


// Evaluation in groups, point-wise revision and the warning for lost sections.
void (async () => {
  const {
    anbieterPointGroups,
    mergeRevisedAnbieterItems,
    openPointsWithSource,
    pointsNamedInInstruction,
    ANBIETER_POINTS: POINTS,
  } = await import("../lib/dt/transcripts/workshop-model");
  const { evaluateAnbieterCorpusWith } = await import("../lib/dt/transcripts/anbieter-eval");

  const groups = anbieterPointGroups();
  assert.deepEqual(groups.map((group) => group.length), [4, 3, 3, 3]);
  assert.deepEqual(groups.flat(), POINTS.map((point) => point.key));
  assert.deepEqual(anbieterPointGroups(["ziele", "preis"]), [["preis", "ziele"]]);

  assert.deepEqual(
    pointsNamedInInstruction("Bitte Preis & Positionierung, Anfragen und Kanäle sowie Ziele & Weiterentwicklung füllen."),
    ["preis", "kanaele", "ziele"],
  );
  assert.deepEqual(pointsNamedInInstruction("Der Preis ist falsch, es sind 90 Euro."), []);
  assert.deepEqual(pointsNamedInInstruction("Wettbewerb kürzen"), ["wettbewerb"]);

  const source = (id: string, rawText: string) => ({
    id,
    title: `Quelle ${id}`,
    filename: `${id}.md`,
    sourceKind: "summary" as const,
    spokenOn: "2026-01-01",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    summary: rawText,
    rawText,
  });
  const doc = source(
    "a",
    [
      "## 1. Unternehmen & Kern",
      "Makler in Moers.",
      "## 10. Sprache & Ton",
      "Sie-Form.",
      "## 11. Preis & Positionierung",
      "Beratung ohne Honorar.",
      "## 12. Anfragen & Kanäle",
      "",
      "## 13. Ziele & Weiterentwicklung",
      "Zweites Büro.",
    ].join("\n"),
  );
  const filled = (texts: Record<string, string>) =>
    normalizeAnbieterItems(Object.entries(texts).map(([key, current]) => ({ key, current })));

  const open = openPointsWithSource(filled({ unternehmen: "Makler in Moers.", sprache: "Sie-Form." }), [doc]);
  assert.deepEqual(open.map((point) => point.key), ["preis", "ziele"], "an empty section and a filled point raise no warning");
  assert.match(open[0]?.sources[0] ?? "", /Quelle a/);
  assert.deepEqual(openPointsWithSource(filled({ unternehmen: "x" }), [source("b", "Preis: 20 Euro\nmehr Text")]), []);
  assert.deepEqual(
    readAnbieterState({ items: filled({ unternehmen: "x" }), sourceFingerprint: "f" }, "f", [doc]).openWithSource.map((p) => p.key),
    ["sprache", "preis", "ziele"],
  );

  const current = filled({ unternehmen: "Alt U", sprache: "Alt S", preis: "Alt P" });
  const merged = mergeRevisedAnbieterItems({
    current,
    revised: filled({ unternehmen: "Neu U", ziele: "Neu Z" }),
    returned: ["unternehmen", "sprache", "preis", "ziele"],
    named: ["preis", "ziele"],
  });
  const text = (items: typeof merged, key: string) => items.find((item) => item.key === key)?.current;
  assert.equal(text(merged, "unternehmen"), "Neu U");
  assert.equal(text(merged, "sprache"), "Alt S", "an empty answer never deletes a point nobody named");
  assert.equal(text(merged, "preis"), "", "a named point can be emptied");
  assert.equal(text(merged, "ziele"), "Neu Z");

  // --- Statements, coverage and fact check: plain code -------------------------------
  const st = await import("../lib/dt/transcripts/anbieter-statements");
  const { extractPendingStatements, statementSources, buildAnbieterReview } = await import(
    "../lib/dt/transcripts/anbieter-eval"
  );
  const { buildCurrentAnbieterMarkdown: markdown } = await import("../lib/dt/transcripts/anbieter-markdown");

  const long = Array.from({ length: 50 }, (_, i) => `Zeile ${i} ${"x".repeat(90)}`).join("\n");
  const pieces = st.chunkSourceText(long, 1_000);
  assert.ok(pieces.length > 4 && pieces.every((piece) => piece.length <= 1_000));
  assert.equal(pieces.join("\n"), long, "chunking loses no line");

  const facts = (text: string) => st.extractFacts(text).map((fact) => `${fact.kind}:${fact.canon}`);
  assert.deepEqual(
    facts("Ab 1.500 € bzw. 49,90 Euro, 12 % Rabatt, seit März 2024, am 3.4.2025, 120 Kunden, 3 Büros."),
    ["euro:1500", "euro:49.9", "prozent:12", "datum:3.2024", "datum:3.4.2025", "zahl:120", "zahl:3"],
  );
  assert.deepEqual(facts("Mail info@fischer.de, Web https://www.fischer-moers.de/kontakt/ Tel. 02841 123456."), [
    "email:info@fischer.de",
    "url:fischer-moers.de/kontakt",
    "telefon:02841123456",
  ]);
  assert.deepEqual(facts("## 11. Preis\n[00:12:45] Gründung 1998 um 14:30 Uhr\n2. Punkt"), ["jahr:1998"]);
  assert.deepEqual(st.droppedFacts("90 Euro und 12 %", "Kostet 90 €."), [{ kind: "prozent", value: "12 %" }]);
  assert.deepEqual(st.droppedFacts("90 Euro und 12 %", "Kostet 90 €.", "12 Prozent streichen"), []);
  assert.equal(st.instructionDeletes("Bitte den Rabatt streichen"), true);
  assert.equal(st.instructionDeletes("Preis ist 90 Euro"), false);

  const knownIds = new Set(["1.1", "1.2", "1.3", "2.1"]);
  assert.deepEqual(st.parseStatementIds(["1.1", "[2.1]", "9.9"], knownIds), ["1.1", "2.1"]);
  assert.deepEqual(st.parseStatementIds("1.1-1.3", knownIds), ["1.1", "1.2", "1.3"]);

  type Call = Parameters<typeof evaluateAnbieterCorpusWith>[0]["call"];
  const usage = { inputTokens: 1, outputTokens: 1 };
  const older = { ...source("alt", "Die Beratung kostet 80 Euro. Büro in Moers. Kunden fragen oft nach Fahrrädern."), spokenOn: "2025-01-01" };
  const newer = {
    ...source("neu", "## Preis & Positionierung\nDie Beratung kostet 90 Euro.\nThorsten Fischer ist im BVMW seit März 2024. Erreichbar unter info@fischer.de."),
    spokenOn: "2026-01-01",
  };
  const bestand = [newer, older];
  const lines: Record<string, string[]> = {
    alt: ["Die Beratung kostet 80 Euro.", "Das Büro ist in Moers.", "Kunden fragen oft nach Fahrrädern."],
    neu: [
      "Die Beratung kostet 90 Euro.",
      "Thorsten Fischer ist im BVMW seit März 2024.",
      "Erreichbar unter info@fischer.de.",
    ],
  };
  let extractCalls = 0;
  const extractCall: Call = async ({ user }) => {
    extractCalls += 1;
    const id = user.includes("Quelle neu") ? "neu" : "alt";
    return { json: { aussagen: lines[id], eigennamen: ["Thorsten Fischer", "BVMW", "Erfunden GmbH"] }, usage, model: "m" };
  };
  const first = await extractPendingStatements({ sources: bestand, store: {}, call: extractCall, concurrency: 1 });
  assert.equal(first.pending, 1, "one piece per round with concurrency 1");
  const second = await extractPendingStatements({ sources: bestand, store: first.store, call: extractCall });
  assert.equal(second.pending, 0);
  const third = await extractPendingStatements({ sources: bestand, store: second.store, call: extractCall });
  assert.equal(extractCalls, 2, "an unchanged source is never read twice");
  assert.equal(third.total, 2);
  const store = second.store;
  const numbered = st.numberStatements(statementSources(bestand), store);
  assert.deepEqual(numbered.map((s) => s.id), ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3"], "old source first");
  assert.ok(Object.values(store).every((chunk) => !chunk.names.includes("Erfunden GmbH")), "a name must be in the text");

  // Full run: groups; contradiction 80 vs 90 Euro; 1.3 taken by nobody, 2.3 placed afterwards.
  const point = (text: string, ids: string[], widersprueche?: unknown) => ({ text, ids, ...(widersprueche ? { widersprueche } : {}) });
  const seen: string[][] = [];
  const fullCall: Call = async ({ tool }) => {
    if (tool.name === "submit_zuordnung") {
      return { json: { zuordnung: [{ id: "2.3", punkt: "kanaele" }, { id: "1.3", punkt: "keiner" }] }, usage, model: "m" };
    }
    const keys = Object.keys((tool.input_schema as { properties: Record<string, unknown> }).properties);
    seen.push(keys);
    const json: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, point("", [])]));
    if ("unternehmen" in json) json.unternehmen = point("Büro in Moers. Thorsten Fischer ist im BVMW.", ["1.2", "2.2"]);
    if ("preis" in json) {
      json.preis = point("", [], [
        { thema: "Preis der Beratung", angaben: [{ text: "80 Euro", ids: ["1.1"] }, { text: "90 Euro", ids: ["2.1"] }] },
      ]);
    }
    return { json, usage, model: "m" };
  };
  const full = await evaluateAnbieterCorpusWith({ organisationName: "Fischer", sources: bestand, store, call: fullCall });
  assert.deepEqual(seen.slice(0, 4).map((keys) => keys.length).sort(), [3, 3, 3, 4]);
  assert.ok(seen.slice(4).some((keys) => keys.length === 1 && keys[0] === "preis"), "a lost section is asked for once more");
  const item = (items: typeof full.items, key: string) => items.find((entry) => entry.key === key)!;
  assert.equal(item(full.items, "kanaele").current, "Erreichbar unter info@fischer.de.", "a late statement goes in word for word");
  const conflict = item(full.items, "preis").conflicts?.[0];
  assert.deepEqual(conflict?.claims.map((claim) => [claim.text, claim.newest, claim.date]), [
    ["80 Euro", false, "2025-01-01"],
    ["90 Euro", true, "2026-01-01"],
  ]);
  assert.equal(conflict?.claims[0]?.dateOrigin, "gespraech");
  assert.deepEqual(full.review.unassigned.map((s) => s.id), ["1.3"], "an unassigned statement is shown, not dropped");
  assert.match(full.review.unassigned[0]?.source ?? "", /Quelle alt/);
  assert.equal(full.review.statementCount, 6);
  assert.deepEqual(
    full.review.missingFacts.map((fact) => `${fact.kind}:${fact.value}`),
    ["datum:März 2024"],
    "the amounts show in the contradiction, the mail in its point; only the date is gone",
  );
  assert.match(full.review.missingFacts[0]?.sources[0] ?? "", /Quelle neu/);
  const md = markdown({ organisationName: "Fischer", items: full.items });
  assert.match(md, /## Nicht verwenden, bis geklärt\n[^\n]+\n- Preis & Positionierung: Preis der Beratung/);
  assert.equal(/80 Euro|90 Euro/.test(md), false, "neither side of a contradiction reaches the SEO-Berater");
  assert.equal(/- Preis & Positionierung$/m.test(md), false, "a point with a contradiction is not „Noch offen“");

  // The review survives the round trip through the saved row; the browser never gets the statements.
  const restored = readAnbieterState(
    { items: full.items, review: full.review, extraction: store, sourceFingerprint: "f" },
    "f",
    bestand,
  );
  assert.deepEqual(restored.review, full.review);
  assert.deepEqual(item(restored.items, "unternehmen").statementIds, ["1.2", "2.2"]);
  assert.equal(Object.keys(restored.extraction).length, 2);
  const { anbieterForClient } = await import("../lib/dt/transcripts/workshop-model");
  assert.equal("extraction" in anbieterForClient(restored), false);

  // Revision with a named point: only it is asked for; what it loses is reported.
  const revisedKeys: string[][] = [];
  const revision = await evaluateAnbieterCorpusWith({
    organisationName: "Fischer",
    sources: bestand,
    store,
    instruction: "Unternehmen & Kern kürzer fassen.",
    current: { items: full.items, review: full.review },
    call: async ({ tool }) => {
      const keys = Object.keys((tool.input_schema as { properties: Record<string, unknown> }).properties);
      revisedKeys.push(keys);
      return { json: { unternehmen: point("Büro in Moers.", ["1.2"]) }, usage, model: "m" };
    },
  });
  assert.deepEqual(revisedKeys, [["unternehmen", "entfernt_ids"]]);
  assert.equal(item(revision.items, "unternehmen").current, "Büro in Moers.");
  assert.equal(item(revision.items, "kanaele"), item(full.items, "kanaele"), "an untouched point stays the same object");
  assert.deepEqual(
    revision.review.lostInRevision.map((lost) => [lost.id, lost.point]),
    [["2.2", "Unternehmen & Kern"]],
    "a statement that was in and is gone is shown",
  );

  // The same loss, but the instruction deletes it: nothing is reported, and it does not come back as unassigned.
  const deletion = await evaluateAnbieterCorpusWith({
    organisationName: "Fischer",
    sources: bestand,
    store,
    instruction: "In Unternehmen & Kern die BVMW-Mitgliedschaft streichen.",
    current: { items: full.items, review: full.review },
    call: async () => ({ json: { unternehmen: point("Büro in Moers.", ["1.2"]), entfernt_ids: ["2.2"] }, usage, model: "m" }),
  });
  assert.deepEqual(deletion.review.lostInRevision, []);
  assert.deepEqual(deletion.review.dismissedIds, ["2.2"]);
  assert.deepEqual(deletion.review.unassigned.map((s) => s.id), ["1.3"]);

  // Revision without a named point: the model returns what it changes; an empty answer changes nothing.
  const loose = await evaluateAnbieterCorpusWith({
    organisationName: "Fischer",
    sources: bestand,
    store,
    instruction: "Das Büro ist in Straelen.",
    current: { items: full.items, review: full.review },
    call: async ({ tool }) => {
      assert.deepEqual((tool.input_schema as { required?: string[] }).required, []);
      return { json: { unternehmen: point("Büro in Straelen. Thorsten Fischer ist im BVMW.", ["1.2", "2.2"]), kanaele: point("", []) }, usage, model: "m" };
    },
  });
  assert.match(item(loose.items, "unternehmen").current, /Straelen/);
  assert.equal(item(loose.items, "kanaele").current, "Erreichbar unter info@fischer.de.");
  assert.deepEqual(loose.review.lostInRevision, []);

  // A stand from before the check has no review: an instruction then runs the full evaluation.
  await assert.rejects(
    evaluateAnbieterCorpusWith({ organisationName: "Fischer", sources: bestand, store: {}, call: fullCall }),
    /noch nicht aus allen Quellen/,
  );
  assert.equal(buildAnbieterReview({ sources: statementSources(bestand), store, statements: numbered, items: full.items }).unassignedCount, 1);

  // --- Internal notes ---------------------------------------------------------------
  assert.deepEqual(facts("Es gibt 2 Standorte und zwei Büros, Punkt 3 gilt.\n3 Gründe\n12 Kunden"), ["zahl:2", "zahl:2"]);
  assert.deepEqual(st.droppedFacts("3 Büros", "drei Büros"), []);

  const regions = st.splitInternalRegions(
    ["# Profil", "Makler in Moers.", "## Kundenbestand (nur intern)", "1.200 Kunden.", "### Details", "Davon 300 Gewerbe.", "## Leistungen", "PKV und bAV."].join("\n"),
  );
  assert.deepEqual(
    regions.map((region) => [region.internal, region.text.split("\n")[0]]),
    [[false, "# Profil"], [true, "## Kundenbestand (nur intern)"], [false, "## Leistungen"]],
    "an internal heading holds until the next heading of its level",
  );
  assert.equal(st.isInternalText("Wir nutzen Calendly (nur intern)."), true);
  assert.equal(st.isInternalText("Das Wort „günstig“ nicht verwenden."), false, "a wording rule is no internal note");

  assert.equal(st.documentStandDate("Anbieterprofil\nStand: 12.03.2026\n\nText"), "2026-03-12");
  assert.equal(st.documentStandDate("Version vom 3. März 2025"), "2025-03-03");
  assert.equal(st.filenameDate("2026-02-01_fischer_briefing.md"), "2026-02-01");
  assert.equal(st.filenameDate("briefing-01.02.2026.md"), "2026-02-01");
  const dated = (over: Partial<Parameters<typeof st.resolveSourceDate>[0]>) =>
    st.resolveSourceDate({ spokenOn: null, text: "Text", filename: "a.md", title: null, createdAt: "2026-05-05T10:00:00Z", ...over });
  assert.deepEqual(dated({ text: "Stand: 01.04.2026" }), { date: "2026-04-01", origin: "dokument" });
  assert.deepEqual(dated({ filename: "20260115-notiz.md" }), { date: "2026-01-15", origin: "dateiname" });
  assert.deepEqual(dated({}), { date: "2026-05-05", origin: "upload" });
  assert.deepEqual(dated({ spokenOn: "2025-12-24", text: "Stand: 01.04.2026" }), { date: "2025-12-24", origin: "gespraech" });

  // The document date decides „newer“, not the upload order.
  const lateUpload = { ...source("spaet", "Stand: 01.01.2024\nAlte Angabe."), spokenOn: null, createdAt: "2026-06-01T00:00:00Z" };
  const earlyUpload = { ...source("frueh", "Stand: 01.01.2026\nNeue Angabe."), spokenOn: null, createdAt: "2026-01-01T00:00:00Z" };
  assert.deepEqual(statementSources([earlyUpload, lateUpload]).map((s) => [s.id, s.dateOrigin]), [
    ["spaet", "dokument"],
    ["frueh", "dokument"],
  ]);

  const mixed = {
    ...source(
      "mix",
      ["## Leistungen", "PKV und bAV.", "Wir buchen über Calendly.", "## Nur intern", "Der Bestand umfasst 1.200 Kunden.", "Stiftung Warentest hat uns schlecht bewertet."].join("\n"),
    ),
    spokenOn: "2026-02-02",
  };
  const mixCall: Call = async ({ user, tool }) => {
    if (tool.name === "submit_aussagen") {
      const internalPart = user.includes("als intern gekennzeichnet");
      return {
        json: internalPart
          ? { aussagen: [{ text: "Der Bestand umfasst 1.200 Kunden.", intern: false }, { text: "Stiftung Warentest hat uns schlecht bewertet.", intern: false }], eigennamen: ["Stiftung Warentest"] }
          : { aussagen: [{ text: "PKV und bAV.", intern: false }, { text: "Wir buchen über Calendly.", intern: true }], eigennamen: ["Calendly"] },
        usage,
        model: "m",
      };
    }
    if (tool.name === "submit_leitplanken") {
      assert.equal(user.includes("PKV und bAV"), false);
      return {
        json: {
          leitplanken: [
            { regel: "Kundenbestand nicht nennen.", ids: ["1.3"] },
            { regel: "1.200 Kunden nicht nennen.", ids: ["1.3"] },
            { regel: "Keine Stiftung-Warentest-Ergebnisse verwenden.", ids: ["1.4"] },
          ],
        },
        usage,
        model: "m",
      };
    }
    assert.equal(/1\.200|Warentest|Calendly/.test(user), false, "no internal statement reaches the assignment");
    const keys = Object.keys((tool.input_schema as { properties: Record<string, unknown> }).properties);
    const json: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, point("", [])]));
    if ("leistungen" in json) json.leistungen = point("PKV und bAV.", ["1.1"]);
    return { json, usage, model: "m" };
  };
  let mixStore: Awaited<ReturnType<typeof extractPendingStatements>>["store"] = {};
  mixStore = (await extractPendingStatements({ sources: [mixed], store: mixStore, call: mixCall })).store;
  const mix = await evaluateAnbieterCorpusWith({ organisationName: "Fischer", sources: [mixed], store: mixStore, call: mixCall });
  assert.deepEqual(mix.review.internal.map((s) => s.id), ["1.2", "1.3", "1.4"], "marked by the model, and by the heading in code");
  assert.deepEqual(mix.review.guardrails, [
    { rule: "Kundenbestand nicht nennen.", ids: ["1.3"] },
    { rule: "Keine Stiftung-Warentest-Ergebnisse verwenden.", ids: ["1.4"] },
  ], "a rule with a number would leak the note and is dropped");
  assert.deepEqual(mix.review.unassigned, [], "internal statements are not „unassigned“");
  assert.deepEqual(mix.review.missingFacts, [], "what the internal area shows is not missing");
  assert.equal(mix.items.some((entry) => /1\.200|Warentest|Calendly/.test(entry.current)), false);
  const mixMd = markdown({
    organisationName: "Fischer",
    items: mix.items,
    guardrails: mix.review.guardrails.map((guardrail) => guardrail.rule),
  });
  assert.match(mixMd, /## Leitplanken \(verbindlich\)[\s\S]*- Kundenbestand nicht nennen\./);
  assert.equal(/1\.200|schlecht bewertet|Calendly/.test(mixMd), false, "the SEO-Berater gets the prohibition, not the note");
  const { anbieterLeitplankenSection } = await import("../lib/dt/transcripts/anbieter-markdown");
  const { extractBlockedStatements } = await import("../lib/dt/content/pipeline/blocked");
  const section = anbieterLeitplankenSection({
    items: full.items,
    guardrails: mix.review.guardrails.map((guardrail) => guardrail.rule),
  });
  assert.deepEqual(
    extractBlockedStatements([section!]).map((blocked) => blocked.text.replace(/^Nicht verwenden, auch nicht sinngemäß:\s*/, "")),
    [
      "Kundenbestand nicht nennen.",
      "Keine Stiftung-Warentest-Ergebnisse verwenden.",
      "Preis & Positionierung: Preis der Beratung (Angaben widersprechen sich, bis zur Klärung nicht verwenden)",
    ],
    "the content pipeline reads every guard rail as blocked",
  );
  console.log("anbieter statements, coverage, facts, contradictions, revision ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
