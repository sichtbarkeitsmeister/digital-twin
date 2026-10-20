/**
 * Hormozi tool (Verwaltung → Hormozi): the standalone prompt (the Hormozi instruction from
 * Globale Prompts filled for the page type, the tool's rules, the Vorschritte block instead of
 * the Analyse, the text, Anbieterfakten and the required avatar), the hero placeholder after
 * the first block, the one retry for a missing hero sentence and the result with the Hormozi
 * building blocks. Mocked model and database, no network.
 * Run: npx tsx scripts/test-text-tools-hormozi.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { contentExportFile } from "../lib/dt/content/export";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import {
  CONTENT_HERO_BLOCK_ID,
  CONTENT_HERO_PLACEHOLDER,
  HORMOZI_MAX_TOKENS,
  TEXT_TOOL_SCHEMA,
  contentStepPromptVariables,
} from "../lib/dt/content/pipeline/prompts";
import { renderBlocksHtml, type ContentTextBlock } from "../lib/dt/content/render";
import { CONTENT_STEP_PROMPT_META, DEFAULT_CONTENT_STEP_PROMPTS, fillContentStepPrompt } from "../lib/dt/content/step-prompts";
import {
  HORMOZI_TOOL_HERO_RETRY_NOTE,
  HORMOZI_TOOL_NO_ANALYSE,
  HORMOZI_TOOL_RULES,
  HORMOZI_TOOL_TIMEOUT_MS,
  HORMOZI_TOOL_USAGE_MODE,
  hasHeroSentence,
  hormoziToolInputBlocks,
  hormoziToolInstruction,
  hormoziToolRequestSchema,
  hormoziToolSpec,
  loadHormoziToolContext,
  normalizeHormoziToolOutput,
  runHormoziOnContext,
  type HormoziToolContext,
  type HormoziToolModelCall,
  type HormoziToolUsage,
} from "../lib/dt/text-tools/hormozi";
import { SEO_TOOL_PAGE_TYPES } from "../lib/dt/text-tools/seo";

const UNTERSEITE_CTA = "Jede Handlungsaufforderung nennt, was der Leser bekommt und was der nächste Schritt ist.";
const RATGEBER_CTA = "Ratgeberartikel: Problem–Lösung-Zyklus, am Ende ein weicher nächster Schritt";

const sections = [{ key: "kontakt", label: "Kontakt", current: "Telefon 0251 123456, Termine online." }];
const uploadBlocks: ContentTextBlock[] = [
  { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1, html: "<p>Wir behandeln.</p>" },
  { id: "abschnitt-2", heading: "Prophylaxe", level: 2, html: "<p>Alle sechs Monate.</p>" },
  { id: "abschnitt-3", heading: "Ablauf", level: 3, html: "<p>Termin, Reinigung, Beratung.</p>" },
];

function toolContext(extra: Partial<HormoziToolContext> = {}): HormoziToolContext {
  return {
    organisationName: "Praxis Dr. Test",
    fileName: "leistungen.docx",
    pageName: "Leistungen",
    pageType: "unterseite",
    sections,
    avatar: { name: "Anna", role: "Patientin", beschreibung: "45, berufstätig, Angst vor dem Bohrer." },
    hormoziPrompt: null,
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
    ...extra,
  };
}

// --- system prompt -------------------------------------------------------------------------------

/** Without a saved text the instruction is the Globale-Prompts default, filled for the page type; the tool's rules follow. */
function testSystemPromptUsesGlobalHormoziPrompt() {
  const context = toolContext();
  const spec = hormoziToolSpec(context);
  const instruction = hormoziToolInstruction(context);
  assert.equal(
    instruction,
    fillContentStepPrompt(
      DEFAULT_CONTENT_STEP_PROMPTS.hormozi,
      contentStepPromptVariables({ organisationName: "Praxis Dr. Test", page: { source: "standalone", page_type: "unterseite" } }),
    ),
  );
  assert.equal(spec.system, `${instruction}\n\n${HORMOZI_TOOL_RULES}`, "instruction first, then the fixed rules, nothing else");
  assert.match(spec.system, /^Schritt 5 Hormozi/);
  assert.ok(spec.system.includes(UNTERSEITE_CTA), "{{cta_regel}} for an Unterseite");
  assert.ok(!spec.system.includes(RATGEBER_CTA));
  assert.doesNotMatch(spec.system, /\{\{/, "no unfilled variable");
  // Nothing from Texte's settings: no Vorgaben, no Branchenregel.
  assert.doesNotMatch(spec.system, /Branchenregel|aus den Vorgaben gelten/);
  // The tool's rules: facts only from text and Anbieterfakten, markers instead of inventions, the text's own voice.
  assert.match(HORMOZI_TOOL_RULES, /ausschließlich aus dem hochgeladenen Text und den Anbieterfakten/);
  assert.match(HORMOZI_TOOL_RULES, /widerspricht, bleibt stehen und bekommt den Marker \[BITTE PRÜFEN: …\]; nichts streichen/);
  assert.match(HORMOZI_TOOL_RULES, /Anrede und Ton bleiben wie im hochgeladenen Text, passend zum Avatar/);
  assert.match(HORMOZI_TOOL_RULES, /Fehlen Kontaktwege, Preise, Garantien oder Beweise.*\[BITTE PRÜFEN: was genau fehlt\] statt erfinden/);
  assert.match(HORMOZI_TOOL_RULES, /Verknappung, Garantien und Fristen nur, wenn sie in den Anbieterfakten stehen/);

  const ratgeber = hormoziToolSpec(toolContext({ pageType: "ratgeber" })).system;
  assert.ok(ratgeber.includes(RATGEBER_CTA), "{{cta_regel}} for a Ratgeber");
  assert.ok(!ratgeber.includes(UNTERSEITE_CTA));
  assert.notEqual(ratgeber, spec.system);

  assert.equal(spec.tool.name, "submit_hormozi_tool_text");
  const schema = spec.tool.input_schema as { properties: Record<string, unknown>; required: string[] };
  for (const [key, value] of Object.entries(TEXT_TOOL_SCHEMA.properties as Record<string, unknown>)) {
    assert.deepEqual(schema.properties[key], value, `${key} as in Texte`);
  }
  const bausteine = schema.properties.hormozi as { type: string; properties: Record<string, { type: string }>; required: string[] };
  assert.equal(bausteine.type, "object");
  assert.deepEqual(bausteine.required, ["traumziel", "hauptschmerz", "groesste_huerde", "moeglicher_beweis", "gewuenschter_cta"]);
  assert.ok(bausteine.required.every((k) => bausteine.properties[k]?.type === "string"));
  assert.deepEqual(schema.required, ["title", "meta_description", "blocks", "hormozi"]);
  assert.equal(spec.maxTokens, HORMOZI_MAX_TOKENS);
  assert.equal(HORMOZI_MAX_TOKENS, 12_000, "same budget as Texte step 5");
  assert.match(CONTENT_STEP_PROMPT_META.hormozi.description, /Gilt auch für das Werkzeug Verwaltung → Hormozi\.$/);
  console.log("system prompt from Globale Prompts, cta_regel per page type: ok");
}

/** A text saved under Globale Prompts → Hormozi replaces the default; variables are filled. */
function testSavedGlobalHormoziPromptWins() {
  const own = "Eigene Hormozi-Anweisung für {{firmenname}}: {{cta_regel}} {{unbekannt}}";
  const spec = hormoziToolSpec(toolContext({ hormoziPrompt: own }));
  assert.ok(
    spec.system.startsWith(`Eigene Hormozi-Anweisung für Praxis Dr. Test: ${UNTERSEITE_CTA} {{unbekannt}}\n\n`),
    spec.system.slice(0, 160),
  );
  assert.doesNotMatch(spec.system, /Schritt 5 Hormozi/, "the default instruction is replaced");
  assert.ok(spec.system.endsWith(HORMOZI_TOOL_RULES));
  assert.match(hormoziToolSpec(toolContext({ hormoziPrompt: own, pageType: "ratgeber" })).system, /^Eigene Hormozi-Anweisung für Praxis Dr\. Test: Ratgeberartikel:/);
  assert.equal(hormoziToolSpec(toolContext({ hormoziPrompt: "   " })).system, hormoziToolSpec(toolContext()).system, "empty means the default");
  assert.match(hormoziToolInstruction({ organisationName: "", pageType: "unterseite", hormoziPrompt: "Für {{firmenname}}." }), /^Für \[Firmenname\]\.$/);
  console.log("saved Globale-Prompts Hormozi text wins: ok");
}

// --- user message --------------------------------------------------------------------------------

/** The message holds page, Vorschritte, text (with hero placeholder), Anbieterfakten and avatar – nothing else. */
function testUserPrompt() {
  const user = hormoziToolSpec(toolContext({ title: "Zahnarzt Münster", metaDescription: "Praxis in Münster." })).user;
  assert.ok(
    user.startsWith(
      "## Seite\nOrganisation: Praxis Dr. Test\nSeite: Leistungen\nSeitentyp: Unterseite\nQuelle: hochgeladene Datei „leistungen.docx“ (eigenständiges Hormozi-Werkzeug; keine Seitenstruktur, keine Linkziele bekannt, vorhandene [LINK: …]-Marker bleiben)\n\n",
    ),
    user.slice(0, 300),
  );
  assert.ok(user.includes(HORMOZI_TOOL_NO_ANALYSE));
  assert.match(HORMOZI_TOOL_NO_ANALYSE, /^## Vorschritte\nEs gibt keine Analyse \(Schritt 1\), keinen Faktencheck und keine Anmerkungen der Redaktion\./);
  assert.match(HORMOZI_TOOL_NO_ANALYSE, /traumziel, hauptschmerz, groesste_huerde, moeglicher_beweis \(nur belegte Beweise, sonst „kein belegter Beweis“\), gewuenschter_cta/);
  assert.match(HORMOZI_TOOL_NO_ANALYSE, /Gib sie im Feld hormozi zurück und schreibe den Text damit\.$/);
  assert.match(user, /## Aktueller Text \(Abschnitte mit ihrer id\)\nTitle-Tag: Zahnarzt Münster\nMeta-Description: Praxis in Münster\./);
  assert.ok(
    user.includes(`[Abschnitt abschnitt-1]\n# Zahnarzt in Münster\nWir behandeln.\n\n[Abschnitt ${CONTENT_HERO_BLOCK_ID}]\n## ${CONTENT_HERO_PLACEHOLDER}\n\n[Abschnitt abschnitt-2]`),
    "the hero placeholder stands right after the first block",
  );
  assert.match(user, /## Anbieterfakten aus Fragebogen und Kundengesprächen[\s\S]*### Kontakt\nTelefon 0251 123456, Termine online\./);
  assert.match(user, /## Avatar \(Wunschkunde[\s\S]*Name: Anna\nRolle: Patientin\n45, berufstätig, Angst vor dem Bohrer\./);
  // Texte-only parts never appear: no settings, no Branchenregel, no notes, no Analyse output, no structure.
  assert.doesNotMatch(user, /## Vorgaben|Branchenregel|## Anmerkungen der Redaktion|## Analyse \(Schritt 1\)|Weitere Seiten der Website|Hauptkeyword/);
  const order = ["## Seite", "## Vorschritte", "## Aktueller Text", "## Anbieterfakten", "## Avatar"].map((h) => user.indexOf(h));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "blocks in a fixed order");

  const bare = hormoziToolSpec(toolContext({ pageName: null, sections: [], pageType: "ratgeber" })).user;
  assert.doesNotMatch(bare, /^Seite:/m, "no page label without a Seitenname");
  assert.match(bare, /^Seitentyp: Ratgeberartikel$/m);
  assert.match(bare, /## Anbieterfakten\n\(keine\)/);
  console.log("user prompt: Vorschritte, text, Anbieterfakten, avatar: ok");
}

// --- request and avatar ----------------------------------------------------------------------------

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "44444444-4444-4444-8444-444444444444";
const AVATAR_B = "33333333-3333-4333-8333-333333333333";

const baseRequest = {
  organisationId: ORG_A,
  userId: "22222222-2222-4222-8222-222222222222",
  fileName: "a.txt",
  pageName: null,
  pageType: "unterseite",
  avatarId: AVATAR_B,
  blocks: uploadBlocks,
  title: null,
  metaDescription: null,
};

function testRequestSchema() {
  assert.ok(hormoziToolRequestSchema.safeParse(baseRequest).success);
  for (const pageType of SEO_TOOL_PAGE_TYPES) assert.ok(hormoziToolRequestSchema.safeParse({ ...baseRequest, pageType }).success, pageType);
  // The avatar is required: missing, null, empty or not a uuid all fail.
  const { avatarId: _omit, ...withoutAvatar } = baseRequest;
  void _omit;
  assert.equal(hormoziToolRequestSchema.safeParse(withoutAvatar).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, avatarId: null }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, avatarId: "" }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, avatarId: "kein-uuid" }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, pageType: "nicht_bearbeiten" }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, pageType: null }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({ ...baseRequest, blocks: [] }).success, false);
  assert.equal(hormoziToolRequestSchema.safeParse({}).success, false);
  console.log("request schema, avatar required: ok");
}

/** A fake client that answers `from(table).select().eq()….maybeSingle()` from rows, filtered by every `eq`. */
function fakeDb(rows: Record<string, Array<Record<string, unknown>>>) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      queries.push({ table, filters });
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => ({
          data: (rows[table] ?? []).find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null,
          error: null,
        }),
      };
      return builder;
    },
  };
  return { queries, service: client as unknown as SupabaseClient };
}

/** An avatar of another organisation is refused, before anything else is read. */
async function testAvatarOfAnotherOrganisationRefused() {
  const { queries, service } = fakeDb({
    dt_agents: [{ id: AVATAR_B, organisation_id: ORG_B, name: "Bernd", role: null, prompt_template: "", avatar_data: null }],
  });
  const request = hormoziToolRequestSchema.parse(baseRequest);
  await assert.rejects(
    loadHormoziToolContext(service, request),
    (error: unknown) =>
      error instanceof ContentLlmError && !error.retryable && /Avatar gehört nicht zu dieser Organisation/.test(error.message),
  );
  assert.deepEqual(queries, [{ table: "dt_agents", filters: { organisation_id: ORG_A, id: AVATAR_B } }], "only the avatar was looked up, within the organisation");
  console.log("avatar of another organisation refused: ok");
}

// --- hero placeholder ------------------------------------------------------------------------------

function testHeroPlaceholderAfterFirstBlock() {
  const placeholder = { id: CONTENT_HERO_BLOCK_ID, heading: CONTENT_HERO_PLACEHOLDER, level: 2, html: "" };

  // First block is a heading (the H1): placeholder right under it, every level as before.
  const withHeading = hormoziToolInputBlocks(uploadBlocks);
  assert.deepEqual(withHeading, [uploadBlocks[0], placeholder, uploadBlocks[1], uploadBlocks[2]]);
  assert.deepEqual(
    withHeading.filter((b) => b.id !== CONTENT_HERO_BLOCK_ID).map((b) => b.level),
    uploadBlocks.map((b) => b.level),
    "no level change",
  );

  // First block without a heading (intro paragraph): placeholder after it, the paragraph does not become an H1.
  const intro: ContentTextBlock[] = [
    { id: "abschnitt-1", heading: null, level: 2, html: "<p>Ein Absatz ohne Überschrift.</p>" },
    { id: "abschnitt-2", heading: "Ablauf", level: 2, html: "<p>Text.</p>" },
    { id: "abschnitt-3", heading: "Details", level: 3, html: "<p>Mehr.</p>" },
  ];
  const withoutHeading = hormoziToolInputBlocks(intro);
  assert.deepEqual(withoutHeading, [intro[0], placeholder, intro[1], intro[2]]);
  assert.ok(withoutHeading.every((b) => b.level !== 1), "no paragraph becomes an H1");

  // A Texte export with a filled hero: the old hero gives way to the placeholder, ids stay unique.
  const exported: ContentTextBlock[] = [
    uploadBlocks[0]!,
    { id: CONTENT_HERO_BLOCK_ID, heading: null, level: 2, html: "<p>Alter Hero-Satz.</p>" },
    uploadBlocks[1]!,
  ];
  assert.deepEqual(hormoziToolInputBlocks(exported), [uploadBlocks[0], placeholder, uploadBlocks[1]]);
  assert.deepEqual(hormoziToolInputBlocks([]), []);
  console.log("hero placeholder after the first block, no level change: ok");
}

/** The answer → text as Texte step 5 normalises it: a sentence in the heading moves into a <p>. */
function testHeroSentenceSettled() {
  const current = { blocks: hormoziToolInputBlocks(uploadBlocks), title: null, metaDescription: null };
  const inHeading = normalizeHormoziToolOutput(
    {
      blocks: [
        { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1, html: "<p>Wir behandeln.</p>" },
        { id: CONTENT_HERO_BLOCK_ID, heading: "Endlich angstfrei zum Zahnarzt.", level: 2, html: "" },
      ],
    },
    current,
  );
  const hero = inHeading.blocks.find((b) => b.id === CONTENT_HERO_BLOCK_ID)!;
  assert.deepEqual(hero, { id: CONTENT_HERO_BLOCK_ID, heading: null, level: 2, html: "<p><strong>Endlich angstfrei zum Zahnarzt.</strong></p>" });
  assert.ok(hasHeroSentence(inHeading.blocks));
  assert.deepEqual(inHeading.hormozi, { traumziel: "", hauptschmerz: "", groesste_huerde: "", moeglicher_beweis: "", gewuenschter_cta: "" });

  // Dropped hero → the placeholder returns after the H1 and counts as missing; so does an empty hero.
  const dropped = normalizeHormoziToolOutput({ blocks: [{ id: "abschnitt-1", heading: "H", level: 1, html: "<p>x</p>" }] }, current);
  assert.deepEqual(dropped.blocks.map((b) => b.id), ["abschnitt-1", CONTENT_HERO_BLOCK_ID]);
  assert.equal(hasHeroSentence(dropped.blocks), false);
  assert.equal(hasHeroSentence([{ id: CONTENT_HERO_BLOCK_ID, heading: null, level: 2, html: "<p> </p>" }]), false);
  console.log("hero sentence settled as <p>: ok");
}

// --- run -------------------------------------------------------------------------------------------

const BAUSTEINE = {
  traumziel: "Ein gesundes Lächeln ohne Angst.",
  hauptschmerz: "Angst vor Schmerzen beim Zahnarzt.",
  groesste_huerde: "Schlechte Erfahrungen früher.",
  moeglicher_beweis: "kein belegter Beweis",
  gewuenschter_cta: "Termin online buchen oder anrufen: 0251 123456.",
};

function answerWithHero(hero: { heading: string; html: string } | null, extra: Record<string, unknown> = {}) {
  return {
    title: "",
    meta_description: "Neu.",
    blocks: [
      { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1, html: "<p>Die Praxis Dr. Test behandelt in Münster.</p><script>x</script>" },
      ...(hero ? [{ id: CONTENT_HERO_BLOCK_ID, level: 2, ...hero }] : []),
      { id: "abschnitt-2", heading: "Prophylaxe", level: 2, html: "<p>Alle sechs Monate. Termin online buchen.</p>" },
      { id: "abschnitt-3", heading: "Ablauf", level: 3, html: "<p>Termin, Reinigung, Beratung.</p>" },
    ],
    hormozi: { ...BAUSTEINE, traumziel: `  ${BAUSTEINE.traumziel}  ` },
    ...extra,
  };
}

function scriptedCall(answers: unknown[]) {
  const calls: Parameters<HormoziToolModelCall>[0][] = [];
  const call: HormoziToolModelCall = async (input) => {
    calls.push(input);
    const json = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { json, usage: { inputTokens: 1_000 * calls.length, outputTokens: 2_000 }, model: "claude-sonnet-4-6" };
  };
  return { calls, call };
}

/** One model call with the spec; hero sentence as <p>; building blocks in the result; HTML and .txt export. */
async function testRunOneCall() {
  const { calls, call } = scriptedCall([answerWithHero({ heading: "", html: "<p>Endlich ohne Angst zum Zahnarzt.</p>" })]);
  const used: HormoziToolUsage[] = [];
  const context = toolContext();
  const { result, usage } = await runHormoziOnContext(context, { models: ["claude-sonnet-4-6"], call, onUsage: (u) => void used.push(u) });
  assert.equal(calls.length, 1, "exactly one model call");
  const spec = hormoziToolSpec(context);
  assert.equal(calls[0]!.system, spec.system);
  assert.equal(calls[0]!.user, spec.user);
  assert.equal(calls[0]!.tool.name, "submit_hormozi_tool_text");
  assert.equal(calls[0]!.maxTokens, 12_000);
  assert.equal(calls[0]!.timeoutMs, HORMOZI_TOOL_TIMEOUT_MS);
  assert.equal(HORMOZI_TOOL_TIMEOUT_MS, 270_000);
  assert.deepEqual(calls[0]!.models, ["claude-sonnet-4-6"]);
  assert.deepEqual(usage, [{ model: "claude-sonnet-4-6", inputTokens: 1_000, outputTokens: 2_000 }]);
  assert.deepEqual(used, usage, "one usage event per call");
  assert.equal(HORMOZI_TOOL_USAGE_MODE, "text-tool.hormozi");

  assert.deepEqual(result.blocks.map((b) => b.id), ["abschnitt-1", CONTENT_HERO_BLOCK_ID, "abschnitt-2", "abschnitt-3"]);
  assert.deepEqual(result.blocks[1], { id: CONTENT_HERO_BLOCK_ID, heading: null, level: 2, html: "<p>Endlich ohne Angst zum Zahnarzt.</p>" });
  assert.doesNotMatch(result.blocks[0]!.html, /<script>/);
  assert.deepEqual(result.hormozi, BAUSTEINE, "the building blocks as the model returned them (trimmed)");
  assert.equal(result.title, null, "empty title keeps the upload's (none)");
  assert.equal(result.meta_description, "Neu.");
  assert.equal(result.avatar_name, "Anna");
  assert.equal(result.page_type, "unterseite");
  assert.equal(result.page_name, "Leistungen");
  assert.equal(result.file_name, "leistungen.docx");
  assert.equal(result.input_blocks, 3, "blocks of the upload, without the inserted hero");
  assert.equal(result.input_tokens, 1_000);
  assert.equal(result.output_tokens, 2_000);
  assert.ok(result.cost_eur > 0);
  assert.equal(result.html, renderBlocksHtml(result.blocks));

  const html = contentExportFile("html", { slug: "leistungen-hormozi", title: "Leistungen", html: result.html });
  assert.equal(html.filename, "leistungen-hormozi.html");
  assert.match(html.body, /^<!DOCTYPE html>[\s\S]*<title>Leistungen<\/title>[\s\S]*<h1>Zahnarzt in Münster<\/h1>[\s\S]*<p>Endlich ohne Angst zum Zahnarzt\.<\/p>/);
  const txt = contentExportFile("txt", { slug: "leistungen-hormozi", title: "Leistungen", html: result.html });
  assert.equal(txt.filename, "leistungen-hormozi.txt");
  assert.match(txt.body, /^Zahnarzt in Münster\n\nDie Praxis Dr\. Test behandelt in Münster\.\n\nEndlich ohne Angst zum Zahnarzt\./);
  assert.doesNotMatch(txt.body, /<[a-z]/);
  console.log("run: one call, hero sentence, building blocks, HTML and .txt export: ok");
}

/** A missing hero sentence → one retry with the note; tokens, cost and usage events cover both calls. */
async function testHeroRetryOnce() {
  for (const first of [answerWithHero(null), answerWithHero({ heading: "", html: "" }), answerWithHero({ heading: CONTENT_HERO_PLACEHOLDER, html: "" })]) {
    const { calls, call } = scriptedCall([first, answerWithHero({ heading: "", html: "<p>Endlich ohne Angst zum Zahnarzt.</p>" })]);
    const used: HormoziToolUsage[] = [];
    const { result } = await runHormoziOnContext(toolContext(), { models: ["m"], call, onUsage: (u) => void used.push(u) });
    assert.equal(calls.length, 2, "exactly one retry");
    const spec = hormoziToolSpec(toolContext());
    assert.equal(calls[1]!.system, spec.system);
    assert.equal(calls[1]!.user, `${spec.user}\n\n${HORMOZI_TOOL_HERO_RETRY_NOTE}`);
    assert.equal(HORMOZI_TOOL_HERO_RETRY_NOTE, "Der Hero-Satz fehlt: genau ein Satz als <p> im Abschnitt hero.");
    assert.ok(calls[1]!.timeoutMs! > 0 && calls[1]!.timeoutMs! <= HORMOZI_TOOL_TIMEOUT_MS, "the retry gets what is left of the budget");
    assert.ok(hasHeroSentence(result.blocks));
    assert.equal(result.input_tokens, 3_000);
    assert.equal(result.output_tokens, 4_000);
    assert.equal(used.length, 2, "both calls are recorded");
  }
  console.log("missing hero: one retry: ok");
}

/** Still no hero after the retry → error; both calls recorded. Not enough time left → error without retry. */
async function testHeroMissingTwiceIsAnError() {
  const { calls, call } = scriptedCall([answerWithHero(null), answerWithHero({ heading: "", html: "" })]);
  const used: HormoziToolUsage[] = [];
  await assert.rejects(
    runHormoziOnContext(toolContext(), { models: ["m"], call, onUsage: (u) => void used.push(u) }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && error.message === "Das Modell hat keinen Hero-Satz geliefert. Bitte erneut versuchen.",
  );
  assert.equal(calls.length, 2, "no third call");
  assert.equal(used.length, 2);

  const short = scriptedCall([answerWithHero(null)]);
  await assert.rejects(runHormoziOnContext(toolContext(), { models: ["m"], call: short.call, timeoutMs: 30_000 }), /keinen Hero-Satz/);
  assert.equal(short.calls.length, 1, "no retry without time for a whole rewrite");
  console.log("hero missing twice is an error: ok");
}

/** An answer without blocks is an error, not the upload handed back as if reworked. */
async function testEmptyAnswerIsAnError() {
  const { calls, call } = scriptedCall([{ blocks: [], hormozi: BAUSTEINE }]);
  const used: HormoziToolUsage[] = [];
  await assert.rejects(
    runHormoziOnContext(toolContext(), { models: ["m"], call, onUsage: (u) => void used.push(u) }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && /keinen überarbeiteten Text/.test(error.message),
  );
  assert.equal(calls.length, 1);
  assert.equal(used.length, 1, "the spent call is still recorded");
  console.log("empty answer is an error: ok");
}

async function main() {
  testSystemPromptUsesGlobalHormoziPrompt();
  testSavedGlobalHormoziPromptWins();
  testUserPrompt();
  testRequestSchema();
  await testAvatarOfAnotherOrganisationRefused();
  testHeroPlaceholderAfterFirstBlock();
  testHeroSentenceSettled();
  await testRunOneCall();
  await testHeroRetryOnce();
  await testHeroMissingTwiceIsAnError();
  await testEmptyAnswerIsAnError();
  console.log("ok: text-tools hormozi");
}

void main();
