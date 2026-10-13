/**
 * SEO tool: the standalone context builder, the prompt wiring of step 1 + step 2, the hero
 * placeholder normalisation and the two-call run (mocked model, no network, no database).
 * Run: npx tsx scripts/test-text-tools-seo.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import {
  CONTENT_HERO_BLOCK_ID,
  CONTENT_HERO_PLACEHOLDER,
  contentStepSpec,
  type AnalyseOutput,
  type ContentPipelineContext,
  type TextOutput,
} from "../lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_ANALYSE, CONTENT_STEP_SEO } from "../lib/dt/content/pipeline/steps";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import {
  SEO_TOOL_MAX_MATERIAL_CHARS,
  SEO_TOOL_PAGE_TYPE_OPTIONS,
  SEO_TOOL_SEO_NEEDED_MS,
  buildSeoToolContext,
  materialTextFromBlocks,
  parseAnalyseJson,
  readSeoToolProgress,
  runSeoOnContext,
  seoToolAnalyseSpec,
  seoToolJobFromRow,
  seoToolPayloadSchema,
  seoToolSpec,
  splitSeoKeywords,
  splitSeoLines,
  splitSeoNotes,
  type SeoToolContextInput,
  type SeoToolModelCall,
  type SeoToolProgress,
  type SeoToolResult,
} from "../lib/dt/text-tools/seo";

// --- fixtures ------------------------------------------------------------------------------------

const settings = { anrede: "Sie" as const, branche: "Zahnarztpraxis", tonalitaet: "sachlich" as const, verbotene_woerter: ["nahtlos"] };
const sections = [{ key: "leistungen", label: "Leistungen", current: "Prophylaxe und Implantate in Münster. Telefon 0251 123456." }];

function payload(extra: Partial<SeoToolContextInput["payload"]> = {}): SeoToolContextInput["payload"] {
  return {
    pageName: "Prophylaxe",
    pageType: "unterseite",
    pillarName: "Zahnmedizin",
    mainKeyword: "Prophylaxe Münster",
    secondaryKeywords: ["Zahnreinigung", "prophylaxe münster", "PZR Kosten"],
    h1Options: ["Prophylaxe in Münster – Vorsorge beim Zahnarzt"],
    userQuestions: ["Wie oft zur Prophylaxe?", "Was kostet eine Zahnreinigung?"],
    linkTargets: ["Zahnmedizin", "Kontakt"],
    kiPrompt: "Keine Preise nennen.",
    notes: ["Die Praxis hat drei Standorte."],
    fileName: "prophylaxe-alt.html",
    material: "# Prophylaxe\n\nAlle sechs Monate zur Kontrolle.",
    analyse: null,
    ...extra,
  };
}

function input(extra: Partial<SeoToolContextInput["payload"]> = {}): SeoToolContextInput {
  return {
    organisationName: "Praxis Dr. Test",
    sections,
    settings,
    avatar: { name: "Anna", role: "Patientin", beschreibung: "45, berufstätig." },
    typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
    payload: payload(extra),
  };
}

const analyseFixture: AnalyseOutput = {
  intent: { primary: "transaktional", modifiers: ["lokal"] },
  journey_phase: "loesungssuche",
  conversion_goal: "anfrage",
  content_angle: "problem_loesung",
  main_keyword: "Prophylaxe Münster",
  secondary_keywords: ["Zahnreinigung"],
  main_question: "Wie läuft eine Prophylaxe beim Zahnarzt ab?",
  fanout_questions: [
    { question: "Wie oft zur Prophylaxe?", source: "Spalte H", theme: "Intervall" },
    { question: "Tut die Zahnreinigung weh?", source: "Avatar", theme: "Schmerz" },
  ],
  deferred_questions: [],
  dropped_questions: [],
  hormozi: { traumziel: "Gesunde Zähne", hauptschmerz: "Angst", groesste_huerde: "Zeit", moeglicher_beweis: "kein belegter Beweis", gewuenschter_cta: "Termin anrufen" },
  usable_facts: ["Prophylaxe und Implantate in Münster."],
  missing_facts: ["Preise"],
  assumptions: [],
};

const seoAnswer = {
  title: "Prophylaxe Münster | Praxis Dr. Test",
  meta_description: "Vorsorge in Münster.",
  blocks: [
    { id: "h1", heading: "Prophylaxe Münster: Vorsorge beim Zahnarzt", level: 2, html: "" },
    { id: "zusammenfassung", heading: "Das Wichtigste in Kürze", level: 2, html: "<p>Alle sechs Monate.</p>" },
    { id: "frage-1", heading: "Wie oft zur Prophylaxe?", level: 2, html: "<p>Zweimal im Jahr.</p>" },
    { id: "kontakt", heading: "Termin vereinbaren", level: 2, html: "<p>Telefon 0251 123456.</p>" },
  ],
};

/** A model that answers both tools and records what it was asked. */
function mockModel(options: { analyseModel?: string; seoModel?: string } = {}) {
  const calls: Array<{ tool: string; system: string; user: string; timeoutMs?: number }> = [];
  const call: SeoToolModelCall = async (req) => {
    calls.push({ tool: req.tool.name, system: req.system, user: req.user, timeoutMs: req.timeoutMs });
    if (req.tool.name === "submit_analyse") {
      return { json: analyseFixture, usage: { inputTokens: 5_000, outputTokens: 1_500 }, model: options.analyseModel ?? "claude-sonnet-4-6" };
    }
    assert.equal(req.tool.name, "submit_seo_text");
    return { json: seoAnswer, usage: { inputTokens: 9_000, outputTokens: 4_000 }, model: options.seoModel ?? "claude-sonnet-4-6" };
  };
  return { call, calls };
}

// --- input parsing -------------------------------------------------------------------------------

function testInputParsing() {
  assert.deepEqual(splitSeoKeywords("Zahnreinigung, PZR Kosten; prophylaxe\nZahnreinigung ,, "), ["Zahnreinigung", "PZR Kosten", "prophylaxe"]);
  assert.deepEqual(splitSeoKeywords(""), []);
  assert.deepEqual(splitSeoLines("- Erste?\n2. Zweite?\n\nerste?\n• Dritte", { max: 10, maxChars: 400 }), ["Erste?", "Zweite?", "Dritte"]);
  assert.equal(splitSeoLines(Array.from({ length: 15 }, (_, i) => `Frage ${i}`).join("\n"), { max: 3, maxChars: 400 }).length, 3);
  assert.deepEqual(splitSeoNotes("Erste Anmerkung\nzweite Zeile\n\n\nZweite Anmerkung\r\n\r\n  "), ["Erste Anmerkung\nzweite Zeile", "Zweite Anmerkung"]);

  assert.deepEqual(parseAnalyseJson(""), { ok: true, value: null });
  assert.deepEqual(parseAnalyseJson('{"main_question":"Was?","fanout_questions":[]}'), { ok: true, value: { main_question: "Was?", fanout_questions: [] } });
  assert.equal(parseAnalyseJson("{nope").ok, false);
  assert.equal(parseAnalyseJson("[]").ok, false);
  assert.equal(parseAnalyseJson('{"findings":[]}').ok, false, "a Faktencheck is not an Analyse");

  const blocks = [
    { id: "a", heading: "Titel", level: 1 as const, html: "<p>Erster &amp; Absatz.</p><ul><li>Punkt</li></ul>" },
    { id: "b", heading: null, level: 2 as const, html: "<p>Ohne Überschrift.</p>" },
  ];
  assert.equal(materialTextFromBlocks(blocks), "# Titel\nErster & Absatz.\n\n- Punkt\n\nOhne Überschrift.");
  assert.equal(materialTextFromBlocks([]), null);
  const long = materialTextFromBlocks([{ id: "a", heading: null, level: 2, html: `<p>${"x".repeat(SEO_TOOL_MAX_MATERIAL_CHARS + 500)}</p>` }]);
  assert.ok(long && long.length <= SEO_TOOL_MAX_MATERIAL_CHARS + 20 && long.endsWith("[… gekürzt]"), "long material is clipped, not refused");
  assert.deepEqual(
    SEO_TOOL_PAGE_TYPE_OPTIONS.map((o) => o.value),
    ["hauptsilo", "unterseite", "ratgeber", "standort"],
    "nicht_bearbeiten is not offered",
  );
  console.log("input parsing: ok");
}

function testPayloadSchema() {
  const base = {
    organisationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    ...payload(),
  };
  assert.ok(seoToolPayloadSchema.safeParse(base).success);
  assert.ok(seoToolPayloadSchema.safeParse({ ...base, fileName: null, material: null, analyse: { main_question: "x" } }).success);
  assert.equal(seoToolPayloadSchema.safeParse({ ...base, pageType: "nicht_bearbeiten" }).success, false);
  assert.equal(seoToolPayloadSchema.safeParse({ ...base, pageName: "" }).success, false);
  assert.equal(seoToolPayloadSchema.safeParse({}).success, false);
  console.log("payload schema: ok");
}

// --- context builder -----------------------------------------------------------------------------

function testContextBuilder() {
  const context = buildSeoToolContext(input());
  assert.equal(context.organisationName, "Praxis Dr. Test");
  assert.equal(context.page.source, "standalone");
  assert.equal(context.page.name, "Prophylaxe");
  assert.equal(context.page.page_type, "unterseite");
  assert.equal(context.page.pillar_name, "Zahnmedizin");
  assert.equal(context.page.level, 2);
  assert.equal(context.page.page_role, null);
  assert.equal(context.page.path, null);
  assert.deepEqual(context.page.keywords, {
    main: { text: "Prophylaxe Münster" },
    secondary: [{ text: "Zahnreinigung" }, { text: "PZR Kosten" }],
  });
  assert.deepEqual(context.page.h1_options, ["Prophylaxe in Münster – Vorsorge beim Zahnarzt"]);
  assert.deepEqual(context.page.user_questions, ["Wie oft zur Prophylaxe?", "Was kostet eine Zahnreinigung?"]);
  assert.deepEqual(context.page.internal_link_targets, ["Zahnmedizin", "Kontakt"]);
  assert.equal(context.page.ki_prompt, "Keine Preise nennen.");
  assert.equal(context.existingText, "# Prophylaxe\n\nAlle sechs Monate zur Kontrolle.");
  assert.equal(context.structureOutline, "");
  assert.deepEqual(context.blocks, []);
  assert.equal(context.title, null);
  assert.deepEqual(context.outputs, {}, "no Analyse until the run derives one");
  assert.deepEqual(context.notes, ["Die Praxis hat drei Standorte."]);
  assert.equal(context.typePrompts.unterseite, DEFAULT_CONTENT_TYPE_PROMPTS.unterseite);

  // Hauptsilo pages sit on level 1; the rest below.
  assert.equal(buildSeoToolContext(input({ pageType: "hauptsilo" })).page.level, 1);
  assert.equal(buildSeoToolContext(input({ pageType: "ratgeber" })).page.level, 2);

  // Without a Hauptkeyword the keywords field stays empty and Nebenkeywords ride in the KI-Prompt.
  const derived = buildSeoToolContext(input({ mainKeyword: null, kiPrompt: null, material: null, fileName: null, pillarName: "  " }));
  assert.equal(derived.page.keywords, null);
  assert.match(derived.page.ki_prompt ?? "", /^Nebenkeywords aus dem Briefing[^\n]*Zahnreinigung, prophylaxe münster, PZR Kosten$/);
  assert.equal(derived.page.pillar_name, null);
  assert.equal(derived.existingText, null);
  const bare = buildSeoToolContext(input({ mainKeyword: null, secondaryKeywords: [], kiPrompt: null }));
  assert.equal(bare.page.ki_prompt, null);

  // A pasted Analyse lands normalised in outputs[1]; the briefing's questions never fall off.
  const pasted = buildSeoToolContext(
    input({
      analyse: {
        main_question: "Wie läuft eine Prophylaxe ab?",
        main_keyword: "ignoriert",
        fanout_questions: [{ question: "Tut das weh?", source: "Avatar", theme: "Schmerz" }],
        intent: { primary: "informationell", modifiers: ["ymyl", "unbekannt"] },
      },
    }),
  );
  const analyse = pasted.outputs[CONTENT_STEP_ANALYSE] as AnalyseOutput;
  assert.equal(analyse.main_keyword, "Prophylaxe Münster", "the briefing's Hauptkeyword wins over the pasted one");
  assert.equal(analyse.main_question, "Wie läuft eine Prophylaxe ab?");
  assert.deepEqual(
    analyse.fanout_questions.map((q) => [q.question, q.source]),
    [
      ["Tut das weh?", "Avatar"],
      ["Wie oft zur Prophylaxe?", "Spalte H"],
      ["Was kostet eine Zahnreinigung?", "Spalte H"],
    ],
  );
  assert.deepEqual(analyse.intent, { primary: "informationell", modifiers: ["ymyl"] });
  assert.ok(analyse.secondary_keywords.includes("Zahnreinigung"));
  console.log("context builder: ok");
}

// --- prompt wiring -------------------------------------------------------------------------------

function testSpecsMatchPipelineSteps() {
  const context = buildSeoToolContext(input());
  const withAnalyse: ContentPipelineContext = { ...context, outputs: { [CONTENT_STEP_ANALYSE]: analyseFixture } };

  const analyseSpec = seoToolAnalyseSpec(context);
  assert.deepEqual(analyseSpec.tool, contentStepSpec(CONTENT_STEP_ANALYSE, context).tool);
  assert.equal(analyseSpec.tool.name, "submit_analyse");
  assert.equal(analyseSpec.maxTokens, 6_000);
  assert.match(analyseSpec.system, /Das Hauptkeyword aus dem Briefing ist gesetzt/);
  assert.match(analyseSpec.system, /Die Nutzerfragen aus dem Briefing sind echte Google-Fragen/);
  const derivedSpec = seoToolAnalyseSpec(buildSeoToolContext(input({ mainKeyword: null })));
  assert.match(derivedSpec.system, /Das Briefing nennt kein Hauptkeyword/);
  assert.doesNotMatch(derivedSpec.system, /kommt aus dem Crawl/);

  const spec = seoToolSpec(withAnalyse);
  const step = contentStepSpec(CONTENT_STEP_SEO, withAnalyse);
  assert.equal(spec.system, step.system);
  assert.deepEqual(spec.tool, step.tool);
  assert.equal(spec.tool.name, "submit_seo_text");
  assert.equal(spec.maxTokens, 12_000);

  // The system prompt is the pipeline's for a structure page of the same type and Hauptsilo,
  // apart from naming the briefing instead of the Excel.
  const structure: ContentPipelineContext = { ...withAnalyse, page: { ...withAnalyse.page, source: "structure", path: "/prophylaxe", page_role: "supporting" } };
  const pipelineSystem = contentStepSpec(CONTENT_STEP_SEO, structure).system;
  assert.equal(spec.system, pipelineSystem.replace("H1-Option aus der Excel", "H1-Option aus dem Briefing"));
  assert.match(spec.system, /Seitentyp Unterseite innerhalb eines Hauptsilos[^\n]*„Zahnmedizin“/, "Textvorlage with the Hauptsilo filled in");
  assert.match(spec.system, new RegExp(CONTENT_HERO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")));
  assert.match(spec.system, /Branchenregel Praxis/);
  assert.match(spec.system, /Mindestens 3 Frage-Überschriften/);
  assert.match(seoToolSpec({ ...withAnalyse, page: { ...withAnalyse.page, page_type: "ratgeber" } }).system, /Mindestens 5 Frage-Überschriften/);

  const { user } = spec;
  assert.match(user, /^## Seite\nOrganisation: Praxis Dr\. Test\nSeite: Prophylaxe\nQuelle: eigenständiges SEO-Werkzeug/);
  assert.match(user, /Rolle in der Struktur: keine \(eigenständige Seite\) · Ebene 2/);
  assert.match(user, /Seitentyp: Unterseite\nHauptsilo \(übergeordnete Seite\): Zahnmedizin/);
  assert.match(user, /Hauptkeyword aus dem Briefing \(gesetzt, nicht ersetzen\): Prophylaxe Münster\nNebenkeywords aus dem Briefing: Zahnreinigung, PZR Kosten/);
  assert.match(user, /H1-Optionen aus dem Briefing:\n- Prophylaxe in Münster – Vorsorge beim Zahnarzt/);
  assert.match(user, /Nutzerfragen aus dem Briefing \(zählen wie Spalte H[^\n]*\n- Wie oft zur Prophylaxe\?\n- Was kostet eine Zahnreinigung\?/);
  assert.match(user, /KI-Prompt der Redaktion für diese Seite \(stehende Anweisung\):\nKeine Preise nennen\./);
  assert.match(user, /Erlaubte interne Linkziele \(nur diese, als Marker \[LINK: Seitenname\]\): Zahnmedizin · Kontakt/);
  assert.match(user, /## Hochgeladenes Material \(Briefing oder bisheriger Text, nur zur Orientierung\)\n[^\n]*\n# Prophylaxe\n\nAlle sechs Monate zur Kontrolle\./);
  assert.match(user, /## Analyse \(Schritt 1\)\n[\s\S]*"main_question": "Wie läuft eine Prophylaxe beim Zahnarzt ab\?"/);
  assert.match(user, /## Anbieterfakten aus Fragebogen und Kundengesprächen[\s\S]*### Leistungen\nProphylaxe und Implantate in Münster\./);
  assert.match(user, /## Vorgaben\nAnrede: Sie[\s\S]*Branche: Zahnarztpraxis[\s\S]*„nahtlos“/);
  assert.match(user, /## Avatar \(Wunschkunde[\s\S]*Name: Anna\nRolle: Patientin\n45, berufstätig\./);
  assert.match(user, /## Anmerkungen der Redaktion[^\n]*\n1\. KI-Prompt aus der Seitenstruktur: Keine Preise nennen\.\n2\. Die Praxis hat drei Standorte\./);
  assert.doesNotMatch(user, /Weitere Seiten der Website|Live-Website|Excel/);

  const bare = seoToolSpec({ ...buildSeoToolContext(input({ mainKeyword: null, secondaryKeywords: [], h1Options: [], userQuestions: [], linkTargets: [], kiPrompt: null, notes: [], material: null, fileName: null, pillarName: null })), outputs: { [CONTENT_STEP_ANALYSE]: analyseFixture } }).user;
  assert.match(bare, /Hauptkeyword: nicht vorgegeben/);
  assert.match(bare, /Erlaubte interne Linkziele: keine bekannt – keine internen Links setzen/);
  assert.doesNotMatch(bare, /## Hochgeladenes Material|## Anmerkungen|H1-Optionen|Nutzerfragen/);
  console.log("specs match pipeline steps 1 and 2: ok");
}

// --- hero placeholder normalisation -----------------------------------------------------------

function testHeroPlaceholderNormalisation() {
  const context = buildSeoToolContext(input());
  const spec = seoToolSpec({ ...context, outputs: { [CONTENT_STEP_ANALYSE]: analyseFixture } });

  // The model forgot the hero block and wrote the H1 as level 2: placeholder inserted, H1 forced.
  const out = spec.normalize(seoAnswer, context) as TextOutput;
  assert.deepEqual(
    out.blocks.map((b) => [b.id, b.level, b.heading]),
    [
      ["h1", 1, "Prophylaxe Münster: Vorsorge beim Zahnarzt"],
      [CONTENT_HERO_BLOCK_ID, 2, CONTENT_HERO_PLACEHOLDER],
      ["zusammenfassung", 2, "Das Wichtigste in Kürze"],
      ["frage-1", 2, "Wie oft zur Prophylaxe?"],
      ["kontakt", 2, "Termin vereinbaren"],
    ],
  );
  assert.equal(out.blocks[1]!.html, "");
  assert.equal(out.title, "Prophylaxe Münster | Praxis Dr. Test");

  // A hero the model filled with real copy, placed somewhere else, is reset to the placeholder under the H1.
  const withHero = spec.normalize(
    {
      title: "",
      meta_description: "",
      blocks: [
        seoAnswer.blocks[0],
        seoAnswer.blocks[1],
        { id: CONTENT_HERO_BLOCK_ID, heading: "Ihr Lächeln, unsere Aufgabe", level: 2, html: "<p>Jetzt Termin sichern!</p>" },
        seoAnswer.blocks[3],
      ],
    },
    context,
  ) as TextOutput;
  assert.deepEqual(withHero.blocks.map((b) => b.id), ["h1", CONTENT_HERO_BLOCK_ID, "zusammenfassung", "kontakt"]);
  assert.equal(withHero.blocks[1]!.heading, CONTENT_HERO_PLACEHOLDER);
  assert.equal(withHero.blocks[1]!.html, "");
  assert.equal(withHero.title, null, "empty title stays empty (no page title to fall back to)");

  // No blocks at all: nothing to write, nothing to fall back to (the run then fails retryably).
  const empty = spec.normalize({ blocks: [] }, context) as TextOutput;
  assert.deepEqual(empty.blocks, []);
  console.log("hero placeholder normalisation: ok");
}

// --- the run -------------------------------------------------------------------------------------

async function testRunDerivesAnalyseThenWrites() {
  const context = buildSeoToolContext(input());
  const model = mockModel({ analyseModel: "claude-sonnet-4-6", seoModel: "claude-sonnet-4-5" });
  const saved: SeoToolProgress[] = [];
  const usage: Array<{ model: string; inputTokens: number; outputTokens: number }> = [];
  let clock = 1_000_000;
  const outcome = await runSeoOnContext(context, payload(), {
    call: model.call,
    models: { write: ["claude-sonnet-4-6"] },
    timeoutMs: 225_000,
    now: () => (clock += 10_000),
    saveProgress: async (p) => void saved.push(p),
    recordUsage: async (u) => void usage.push(u),
  });
  assert.equal(outcome.state, "done");
  if (outcome.state !== "done") return;
  assert.deepEqual(model.calls.map((c) => c.tool), ["submit_analyse", "submit_seo_text"]);
  assert.ok((model.calls[0]!.timeoutMs ?? 0) <= 120_000, "the Analyse gets at most its own share of the budget");
  assert.match(model.calls[1]!.user, /## Analyse \(Schritt 1\)\n[\s\S]*"main_question": "Wie läuft eine Prophylaxe beim Zahnarzt ab\?"/, "step 2 reads the derived Analyse");
  assert.match(model.calls[1]!.user, /"question": "Tut die Zahnreinigung weh\?"/);
  assert.equal(saved.length, 1, "the Analyse is stored once, right after step 1");
  assert.equal(saved[0]!.analyse_source, "model");
  assert.equal(saved[0]!.calls, 1);
  assert.deepEqual(usage.map((u) => u.model), ["claude-sonnet-4-6", "claude-sonnet-4-5"]);

  const { result } = outcome;
  assert.equal(result.analyse_source, "model");
  assert.equal(result.analyse.main_question, "Wie läuft eine Prophylaxe beim Zahnarzt ab?");
  assert.equal(result.calls, 2);
  assert.deepEqual(result.models, ["claude-sonnet-4-6", "claude-sonnet-4-5"]);
  assert.equal(result.model, "claude-sonnet-4-5");
  assert.equal(result.input_tokens, 14_000);
  assert.equal(result.output_tokens, 5_500);
  assert.ok(result.cost_eur > 0);
  assert.equal(result.page_name, "Prophylaxe");
  assert.equal(result.page_type, "unterseite");
  assert.equal(result.file_name, "prophylaxe-alt.html");
  assert.equal(result.blocks[1]!.id, CONTENT_HERO_BLOCK_ID);
  assert.match(result.html, /<section data-block-id="h1"><h1>Prophylaxe Münster: Vorsorge beim Zahnarzt<\/h1>/);
  assert.match(result.html, new RegExp(`<section data-block-id="${CONTENT_HERO_BLOCK_ID}"><h2>\\[HERO`));
  console.log("run derives analyse then writes: ok");
}

async function testRunWithPastedAnalyse() {
  const context = buildSeoToolContext(input({ analyse: { ...analyseFixture, main_question: "Eingefügte Frage?" } }));
  const model = mockModel();
  const saved: SeoToolProgress[] = [];
  const outcome = await runSeoOnContext(context, payload(), {
    call: model.call,
    models: { write: ["claude-sonnet-4-6"] },
    saveProgress: async (p) => void saved.push(p),
  });
  assert.equal(outcome.state, "done");
  if (outcome.state !== "done") return;
  assert.deepEqual(model.calls.map((c) => c.tool), ["submit_seo_text"], "a pasted Analyse means one call");
  assert.match(model.calls[0]!.user, /"main_question": "Eingefügte Frage\?"/);
  assert.equal(saved.length, 0);
  assert.equal(outcome.result.analyse_source, "pasted");
  assert.equal(outcome.result.calls, 1);
  assert.equal(outcome.result.input_tokens, 9_000);
  console.log("run with pasted analyse: ok");
}

async function testRunPausesAndResumes() {
  const context = buildSeoToolContext(input());
  const model = mockModel();
  // The Analyse eats the budget: the first tick stores it and hands back `partial`.
  let clock = 0;
  const first = await runSeoOnContext(context, payload(), {
    call: model.call,
    models: { write: ["claude-sonnet-4-6"] },
    timeoutMs: SEO_TOOL_SEO_NEEDED_MS + 30_000,
    now: () => (clock += 20_000),
  });
  assert.equal(first.state, "partial");
  if (first.state !== "partial") return;
  assert.deepEqual(model.calls.map((c) => c.tool), ["submit_analyse"]);
  assert.equal(first.progress.calls, 1);

  // The next tick reads the stored Analyse back from the job row and only writes.
  const stored = JSON.parse(JSON.stringify(first.progress)) as unknown;
  const progress = readSeoToolProgress(stored, context);
  assert.ok(progress && progress.analyse.main_question === analyseFixture.main_question);
  const second = await runSeoOnContext(context, payload(), { call: model.call, models: { write: ["claude-sonnet-4-6"] }, previous: stored });
  assert.equal(second.state, "done");
  if (second.state !== "done") return;
  assert.deepEqual(model.calls.map((c) => c.tool), ["submit_analyse", "submit_seo_text"]);
  assert.equal(second.result.calls, 2);
  assert.equal(second.result.input_tokens, 14_000);
  assert.equal(second.result.analyse_source, "model");

  // A finished result on the row is not a progress; neither is garbage.
  assert.equal(readSeoToolProgress(second.result, context), null);
  assert.equal(readSeoToolProgress(null, context), null);
  assert.equal(readSeoToolProgress({ analyse: "x" }, context), null);
  console.log("run pauses and resumes: ok");
}

async function testRunRejectsEmptyText() {
  const context = buildSeoToolContext(input({ analyse: analyseFixture }));
  const call: SeoToolModelCall = async () => ({ json: { blocks: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" });
  await assert.rejects(
    () => runSeoOnContext(context, payload(), { call, models: { write: ["m"] } }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && /keinen Seitentext/.test(error.message),
  );
  console.log("run rejects empty text: ok");
}

// --- job mapping and export ----------------------------------------------------------------------

function testJobMappingAndExport() {
  const result: SeoToolResult = {
    blocks: [{ id: "h1", heading: "Prophylaxe Münster", level: 1, html: "<p>Vorsorge.</p>" }],
    title: "Prophylaxe Münster",
    meta_description: null,
    html: '<section data-block-id="h1"><h1>Prophylaxe Münster</h1><p>Vorsorge.</p></section>',
    analyse: analyseFixture,
    analyse_source: "model",
    model: "claude-sonnet-4-6",
    models: ["claude-sonnet-4-6"],
    calls: 2,
    input_tokens: 1,
    output_tokens: 1,
    cost_eur: 0.01,
    page_name: "Prophylaxe",
    page_type: "unterseite",
    file_name: null,
  };
  assert.deepEqual(seoToolJobFromRow({ status: "succeeded", result, last_error: null }), { state: "done", progress: null, result, error: null });
  assert.equal(seoToolJobFromRow({ status: "succeeded", result: { analyse: analyseFixture }, last_error: null }).state, "error");
  assert.deepEqual(seoToolJobFromRow({ status: "dead", result: null, last_error: "Kaputt" }), { state: "error", progress: null, result: null, error: "Kaputt" });
  assert.deepEqual(seoToolJobFromRow({ status: "pending", result: null, last_error: "Rate limit" }), { state: "running", progress: null, result: null, error: null });
  assert.equal(
    seoToolJobFromRow({ status: "running", result: { analyse: analyseFixture, calls: 1 }, last_error: null }).progress,
    "Analyse fertig, der Seitentext wird geschrieben.",
  );

  const txt = contentExportFile("txt", { slug: "prophylaxe-seo", title: result.title!, html: result.html });
  assert.equal(txt.body, "Prophylaxe Münster\n\nVorsorge.\n");
  assert.equal(txt.filename, "prophylaxe-seo.txt");
  const html = contentExportFile("html", { slug: "prophylaxe-seo", title: result.title!, html: result.html });
  assert.match(html.body, /<title>Prophylaxe Münster<\/title>[\s\S]*<h1>Prophylaxe Münster<\/h1>/);
  console.log("job mapping and export: ok");
}

async function main() {
  testInputParsing();
  testPayloadSchema();
  testContextBuilder();
  testSpecsMatchPipelineSteps();
  testHeroPlaceholderNormalisation();
  await testRunDerivesAnalyseThenWrites();
  await testRunWithPastedAnalyse();
  await testRunPausesAndResumes();
  await testRunRejectsEmptyText();
  testJobMappingAndExport();
  console.log("ok: text-tools seo");
}

void main();
