/**
 * GEO tool: file ingestion → blocks, and the prompt wiring of the standalone step 4
 * (mocked model, no network, no database for the prompt part).
 * Run: npx tsx scripts/test-text-tools-geo.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import {
  CONTENT_HERO_BLOCK_ID,
  CONTENT_HERO_PLACEHOLDER,
  contentStepSpec,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import { CONTENT_STEP_GEO } from "../lib/dt/content/pipeline/steps";
import { renderBlocksHtml } from "../lib/dt/content/render";
import {
  geoTextToolSpec,
  geoToolJobFromRow,
  geoToolPayloadSchema,
  geoToolResult,
  parseFaktencheckJson,
  splitNotes,
  splitQuestions,
  type GeoToolContext,
} from "../lib/dt/text-tools/geo";
import {
  TEXT_TOOL_MAX_BLOCKS,
  blocksFromDocument,
  extractUploadedDocument,
  isHeadingLikeLine,
} from "../lib/dt/text-tools/ingest";

function ok(result: ReturnType<typeof blocksFromDocument>) {
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.value;
}

// --- ingest: plain text --------------------------------------------------------------------------

function testPlainTextHeuristics() {
  const text = [
    "Badsanierung in Münster",
    "",
    "Wir sanieren Bäder in Münster und Umgebung. Das dauert in der Regel zwei Wochen.",
    "Zweite Zeile des Absatzes.",
    "",
    "Ablauf der Sanierung",
    "",
    "- Beratung vor Ort",
    "- Angebot innerhalb von drei Tagen",
    "- Umsetzung durch eigene Monteure",
    "",
    "Was kostet eine Badsanierung?",
    "",
    "Das hängt von der Größe ab. Ein Richtwert steht im Angebot.",
    "",
    "Abschließender Satz, der kein Titel ist, weil er mit einem Punkt endet.",
  ].join("\n");

  const { blocks, title, metaDescription, chars } = ok(blocksFromDocument({ kind: "text", content: text }));
  assert.equal(title, null);
  assert.equal(metaDescription, null);
  assert.ok(chars > 100);
  assert.deepEqual(
    blocks.map((b) => [b.id, b.heading, b.level]),
    [
      ["abschnitt-1", "Badsanierung in Münster", 1],
      ["abschnitt-2", "Ablauf der Sanierung", 2],
      ["abschnitt-3", "Was kostet eine Badsanierung?", 2],
    ],
  );
  assert.match(blocks[0]!.html, /^<p>Wir sanieren Bäder in Münster und Umgebung\..*<br>Zweite Zeile des Absatzes\.<\/p>$/);
  assert.match(blocks[1]!.html, /^<ul><li>Beratung vor Ort<\/li><li>Angebot innerhalb von drei Tagen<\/li><li>Umsetzung durch eigene Monteure<\/li><\/ul>$/);
  // The closing sentence stays a paragraph of the last block (ends with a period, is last).
  assert.match(blocks[2]!.html, /Abschließender Satz/);
  console.log("ingest text heuristics: ok");
}

function testHeadingLikeLine() {
  assert.equal(isHeadingLikeLine("Unsere Leistungen", true), true);
  assert.equal(isHeadingLikeLine("Was kostet das?", true), true);
  assert.equal(isHeadingLikeLine("Unsere Leistungen", false), false, "last paragraph is never a heading");
  assert.equal(isHeadingLikeLine("Das ist ein Satz.", true), false);
  assert.equal(isHeadingLikeLine("Unsere Leistungen:", true), false);
  assert.equal(isHeadingLikeLine("- Punkt", true), false);
  assert.equal(isHeadingLikeLine("1. Erster Schritt", true), false);
  assert.equal(isHeadingLikeLine("https://example.de", true), false);
  assert.equal(isHeadingLikeLine("a ".repeat(15).trim(), true), false, "too many words");
  console.log("heading-like line: ok");
}

function testMarkdownAndSetext() {
  const text = "# Titel\n\nIntro.\n\n## Zweiter\n\nText.\n\nDritter\n-------\n\nMehr Text.\n\n### Tief\n\nEnde.";
  const { blocks } = ok(blocksFromDocument({ kind: "text", content: text }));
  assert.deepEqual(
    blocks.map((b) => [b.heading, b.level]),
    [
      ["Titel", 1],
      ["Zweiter", 2],
      ["Dritter", 2],
      ["Tief", 3],
    ],
  );
  console.log("markdown headings: ok");
}

function testIntroWithoutHeading() {
  const text = "Ein Absatz ohne Überschrift, der lang genug ist und mit einem Punkt endet.\n\nÜberschrift\n\nText dazu.";
  const { blocks } = ok(blocksFromDocument({ kind: "text", content: text }));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.heading, null);
  assert.equal(blocks[0]!.level, 2, "intro without heading is not promoted to H1");
  assert.equal(blocks[1]!.heading, "Überschrift");
  console.log("intro without heading: ok");
}

// --- ingest: HTML --------------------------------------------------------------------------------

function testHtmlDocument() {
  const html = `<!DOCTYPE html><html lang="de"><head><title>Badsanierung Münster | Firma</title>
<meta name="description" content="Bäder aus einer Hand."><style>p{color:red}</style></head>
<body><nav><a href="/">Start</a></nav><script>alert(1)</script>
<main>
  <h1>Badsanierung in <em>Münster</em></h1>
  <p>Wir sanieren <strong>Bäder</strong> und mehr. <a href="/kontakt" onclick="x()">Kontakt</a></p>
  <div>Loser Text in einem Div.</div>
  <h2>Ablauf</h2>
  <ul><li>Beratung</li><li>Angebot</li></ul>
  <table><tr><th>Leistung</th><th>Dauer</th></tr><tr><td>Bad</td><td>2 Wochen</td></tr></table>
  <h3>Details</h3><p>Mehr.</p>
  <h1>Zweite H1</h1><p>Bleibt keine H1.</p>
</main><footer>Impressum</footer></body></html>`;
  const { blocks, title, metaDescription } = ok(blocksFromDocument({ kind: "html", content: html }));
  assert.equal(title, "Badsanierung Münster | Firma");
  assert.equal(metaDescription, "Bäder aus einer Hand.");
  assert.deepEqual(
    blocks.map((b) => [b.id, b.heading, b.level]),
    [
      ["abschnitt-1", "Badsanierung in Münster", 1],
      ["abschnitt-2", "Ablauf", 2],
      ["abschnitt-3", "Details", 3],
      ["abschnitt-4", "Zweite H1", 2],
    ],
  );
  assert.match(blocks[0]!.html, /<p>Wir sanieren <strong>Bäder<\/strong> und mehr\. <a href="\/kontakt">Kontakt<\/a><\/p>/);
  assert.doesNotMatch(blocks[0]!.html, /onclick/);
  assert.match(blocks[0]!.html, /<p>Loser Text in einem Div\.<\/p>/);
  assert.match(blocks[1]!.html, /<ul><li>Beratung<\/li><li>Angebot<\/li><\/ul>/);
  assert.match(blocks[1]!.html, /<p>Leistung \| Dauer<\/p>\n<p>Bad \| 2 Wochen<\/p>/);
  const all = blocks.map((b) => b.html).join("\n");
  assert.doesNotMatch(all, /alert|Start|Impressum|color:red/);
  console.log("ingest html: ok");
}

function testTexteExportRoundTrip() {
  const blocks = [
    { id: "titel", heading: "Titel", level: 1 as const, html: "<p>Intro</p>" },
    { id: CONTENT_HERO_BLOCK_ID, heading: CONTENT_HERO_PLACEHOLDER, level: 2 as const, html: "" },
    { id: "ablauf", heading: "Ablauf", level: 2 as const, html: "<p>Schritt &amp; Co.</p>" },
  ];
  const exported = contentExportFile("html", { slug: "x", title: "Titel", html: renderBlocksHtml(blocks) });
  const { blocks: back, title } = ok(blocksFromDocument({ kind: "html", content: exported.body }));
  assert.equal(title, "Titel");
  assert.deepEqual(back, blocks, "a Texte export comes back with its ids");
  console.log("texte export round trip: ok");
}

function testLimits() {
  const tooMany = Array.from({ length: TEXT_TOOL_MAX_BLOCKS + 1 }, (_, i) => `<h2>Abschnitt ${i}</h2><p>Text.</p>`).join("");
  const res = blocksFromDocument({ kind: "html", content: tooMany });
  assert.ok(!res.ok && /Abschnitte/.test(res.message));
  const empty = blocksFromDocument({ kind: "text", content: "   \n\n  " });
  assert.ok(!empty.ok && /kein Text/.test(empty.message));
  const long = blocksFromDocument({ kind: "text", content: "x".repeat(70_000) });
  assert.ok(!long.ok && /zu lang/.test(long.message));
  // A long text without headings is split into continuation blocks, never cut.
  const paragraph = `${"Wort ".repeat(300).trim()}.`;
  const unstructured = ok(blocksFromDocument({ kind: "text", content: Array.from({ length: 20 }, () => paragraph).join("\n\n") }));
  assert.ok(unstructured.blocks.length >= 3, `expected continuation blocks, got ${unstructured.blocks.length}`);
  assert.equal(unstructured.blocks[0]!.heading, null);
  assert.equal(unstructured.blocks.map((b) => b.html).join("").match(/<p>/g)?.length, 20, "every paragraph survives");
  assert.ok(unstructured.chars > 29_000);
  console.log("limits: ok");
}

async function testExtractUploadedDocument() {
  const enc = new TextEncoder();
  const txt = await extractUploadedDocument("seite.txt", enc.encode("﻿Hallo"));
  assert.ok(txt.ok && txt.value.kind === "text" && txt.value.content === "Hallo" && txt.value.format === "txt");
  const html = await extractUploadedDocument("seite.HTML", enc.encode("<p>x</p>"));
  assert.ok(html.ok && html.value.kind === "html" && html.value.format === "html");
  const doc = await extractUploadedDocument("alt.doc", enc.encode("\xd0\xcf\x11\xe0 binary"));
  assert.ok(!doc.ok && /\.docx/.test(doc.message));
  const notPdf = await extractUploadedDocument("x.pdf", enc.encode("hello"));
  assert.ok(!notPdf.ok && /keine PDF/.test(notPdf.message));
  const unknown = await extractUploadedDocument("bild.png", new Uint8Array([1, 2, 3]));
  assert.ok(!unknown.ok && /unbekanntes Format/.test(unknown.message));
  const empty = await extractUploadedDocument("leer.txt", new Uint8Array());
  assert.ok(!empty.ok && /leer/.test(empty.message));
  const big = await extractUploadedDocument("gross.txt", new Uint8Array(11 * 1024 * 1024));
  assert.ok(!big.ok && /zu groß/.test(big.message));
  console.log("extract uploaded document: ok");
}

// --- prompt wiring -------------------------------------------------------------------------------

const settings = { anrede: "Sie" as const, branche: "Zahnarztpraxis", tonalitaet: "sachlich" as const, verbotene_woerter: ["nahtlos"] };
const sections = [{ key: "leistungen", label: "Leistungen", current: "Prophylaxe und Implantate in Münster." }];
const uploadBlocks = [
  { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1 as const, html: "<p>Wir behandeln.</p>" },
  { id: CONTENT_HERO_BLOCK_ID, heading: CONTENT_HERO_PLACEHOLDER, level: 2 as const, html: "" },
  { id: "abschnitt-2", heading: "Prophylaxe", level: 2 as const, html: "<p>Alle sechs Monate.</p>" },
];

function toolContext(extra: Partial<GeoToolContext> = {}): GeoToolContext {
  return {
    organisationName: "Praxis Dr. Test",
    fileName: "leistungen.docx",
    pageName: "Leistungen",
    sections,
    settings,
    avatar: { name: "Anna", role: "Patientin", beschreibung: "45, berufstätig." },
    notes: [],
    questions: [],
    faktencheck: null,
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
    ...extra,
  };
}

function testSpecMatchesPipelineStep() {
  const tool = geoTextToolSpec(toolContext());
  const pipelineContext: ContentPipelineContext = {
    organisationName: "Praxis Dr. Test",
    page: {
      name: "Leistungen",
      path: "/leistungen",
      level: 1,
      source: "structure",
      page_role: null,
      page_type: "unterseite",
      pillar_name: null,
      estimated_traffic: null,
      keywords: null,
      h1_options: [],
      user_questions: [],
      ki_prompt: null,
      internal_link_targets: [],
    },
    structureOutline: "",
    existingText: null,
    sections,
    settings,
    avatar: null,
    typePrompts: {} as ContentPipelineContext["typePrompts"],
    notes: [],
    outputs: {},
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
  };
  const step = contentStepSpec(CONTENT_STEP_GEO, pipelineContext);
  assert.equal(tool.system, step.system, "same system prompt as step 4");
  assert.equal(tool.tool.name, "submit_geo_text");
  assert.deepEqual(tool.tool, step.tool);
  assert.equal(tool.maxTokens, step.maxTokens);
  assert.match(tool.system, /Branchenregel Praxis/);
  console.log("spec matches pipeline step 4: ok");
}

/** Verwaltung → GEO reads the GEO instruction saved under Globale Prompts, like step 4. */
function testSavedGeoPrompt() {
  const own = "Eigene GEO-Anweisung für {{firmenname}}: Antworten zuerst.";
  const tool = geoTextToolSpec(toolContext({ geoPrompt: own }));
  assert.ok(tool.system.startsWith("Eigene GEO-Anweisung für Praxis Dr. Test: Antworten zuerst.\n\nDu arbeitest für eine Agentur"), "saved text first, then BASE_RULES");
  assert.doesNotMatch(tool.system, /Schritt 4 GEO/, "the default instruction is replaced");
  assert.match(tool.system, /Branchenregel Praxis/, "the Branchenregel is still added");
  assert.equal(tool.tool.name, "submit_geo_text", "same tool schema");
  assert.equal(geoTextToolSpec(toolContext({ geoPrompt: "   " })).system, geoTextToolSpec(toolContext()).system, "empty means the default");
  assert.match(geoTextToolSpec(toolContext()).system, /^Schritt 4 GEO/);
  console.log("saved GEO prompt: ok");
}

function testUserPromptBlocks() {
  const user = geoTextToolSpec(
    toolContext({
      notes: ["Die Praxis hat drei Standorte."],
      questions: ["Was kostet Prophylaxe?", "Wie oft zur Prophylaxe?"],
      faktencheck: { findings: [{ title: "Unbelegt", problem: "Zahl", proposal: "streichen", severity: "high", block_id: "abschnitt-2" }], questions: [] },
      title: "Zahnarzt Münster",
      metaDescription: "Praxis in Münster.",
    }),
  ).user;
  assert.match(user, /## Seite\nOrganisation: Praxis Dr\. Test\nSeite: Leistungen\nQuelle: hochgeladene Datei „leistungen\.docx“/);
  assert.match(user, /## Aktueller Text \(Abschnitte mit ihrer id\)\nTitle-Tag: Zahnarzt Münster\nMeta-Description: Praxis in Münster\./);
  assert.match(user, /\[Abschnitt abschnitt-1\]\n# Zahnarzt in Münster\nWir behandeln\./);
  assert.match(user, /## Analyse \(Schritt 1\)[\s\S]*"main_question": "Was kostet Prophylaxe\?"[\s\S]*"question": "Wie oft zur Prophylaxe\?"/);
  assert.match(user, /## Faktencheck \(Schritt 3\) – umsetzen[\s\S]*"title": "Unbelegt"/);
  assert.match(user, /## Anbieterfakten aus Fragebogen und Kundengesprächen[\s\S]*### Leistungen\nProphylaxe und Implantate in Münster\./);
  assert.match(user, /## Vorgaben\nAnrede: Sie[\s\S]*Branche: Zahnarztpraxis[\s\S]*Verbotene Wörter[^\n]*„nahtlos“/);
  assert.match(user, /## Avatar \(Wunschkunde[\s\S]*Name: Anna\nRolle: Patientin\n45, berufstätig\./);
  assert.match(user, /## Anmerkungen der Redaktion[^\n]*\n1\. Die Praxis hat drei Standorte\./);
  assert.doesNotMatch(user, /keine Analyse mit Fragen vor|kein Faktencheck vor/);

  const bare = geoTextToolSpec(toolContext()).user;
  assert.match(bare, /Es liegt keine Analyse mit Fragen vor/);
  assert.match(bare, /Es liegt kein Faktencheck vor/);
  assert.doesNotMatch(bare, /## Analyse|## Faktencheck|## Anmerkungen/);
  assert.match(bare, /## Anbieterfakten/);
  console.log("user prompt blocks: ok");
}

function testNormalizeKeepsHero() {
  const spec = geoTextToolSpec(toolContext());
  const json = {
    title: "",
    meta_description: "Neu.",
    blocks: [
      { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1, html: "<p>Die Praxis Dr. Test behandelt in Münster.</p><script>x</script>" },
      { id: "abschnitt-2", heading: "Prophylaxe", level: 2, html: "<p>Alle sechs Monate.</p>" },
      { id: "stand", heading: "", level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
    ],
  };
  const out = spec.normalize(json, {} as ContentPipelineContext) as { blocks: { id: string; html: string }[]; title: string | null; meta_description: string | null };
  assert.deepEqual(
    out.blocks.map((b) => b.id),
    ["abschnitt-1", CONTENT_HERO_BLOCK_ID, "abschnitt-2", "stand"],
    "the dropped hero block returns after the H1",
  );
  assert.equal(out.title, null, "empty title keeps the upload's (none)");
  assert.equal(out.meta_description, "Neu.");
  assert.doesNotMatch(out.blocks[0]!.html, /<script>/);

  // Empty answer → the uploaded text stays.
  const fallback = spec.normalize({ blocks: [] }, {} as ContentPipelineContext) as { blocks: unknown[] };
  assert.equal(fallback.blocks.length, uploadBlocks.length);
  console.log("normalize keeps hero: ok");
}

function testResultAndJobMapping() {
  const result = geoToolResult(
    { blocks: uploadBlocks, title: "T", meta_description: null },
    { model: "claude-sonnet-4-6", usage: { inputTokens: 1_000, outputTokens: 2_000 } },
    { fileName: "a.txt", pageName: null, blocks: uploadBlocks },
  );
  assert.equal(result.input_blocks, 3);
  assert.ok(result.cost_eur > 0);
  assert.match(result.html, /<section data-block-id="abschnitt-1"><h1>Zahnarzt in Münster<\/h1>/);
  const txt = contentExportFile("txt", { slug: "x", title: "T", html: result.html });
  assert.match(txt.body, /^Zahnarzt in Münster\n\nWir behandeln\./);
  assert.equal(txt.filename, "x.txt");

  assert.deepEqual(geoToolJobFromRow({ status: "succeeded", result, last_error: null }), { state: "done", result, error: null });
  assert.deepEqual(geoToolJobFromRow({ status: "dead", result: null, last_error: "Kaputt" }), { state: "error", result: null, error: "Kaputt" });
  assert.deepEqual(geoToolJobFromRow({ status: "pending", result: null, last_error: "Rate limit" }), { state: "running", result: null, error: null });
  console.log("result and job mapping: ok");
}

function testInputParsing() {
  assert.deepEqual(splitNotes("Erste Anmerkung\nzweite Zeile\n\n\nZweite Anmerkung\r\n\r\n  "), ["Erste Anmerkung\nzweite Zeile", "Zweite Anmerkung"]);
  assert.deepEqual(splitQuestions("Hauptfrage?\n- Fan-out 1?\n2. Fan-out 2?\n\n"), ["Hauptfrage?", "Fan-out 1?", "Fan-out 2?"]);
  assert.deepEqual(parseFaktencheckJson(""), { ok: true, value: null });
  assert.deepEqual(parseFaktencheckJson('{"findings":[]}'), { ok: true, value: { findings: [] } });
  assert.equal(parseFaktencheckJson("{nope").ok, false);
  assert.equal(parseFaktencheckJson("42").ok, false);

  const payload = geoToolPayloadSchema.safeParse({
    organisationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    fileName: "a.txt",
    pageName: null,
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
    notes: [],
    questions: [],
    faktencheck: null,
  });
  assert.ok(payload.success);
  assert.equal(geoToolPayloadSchema.safeParse({}).success, false);
  console.log("input parsing: ok");
}

async function main() {
  testPlainTextHeuristics();
  testHeadingLikeLine();
  testMarkdownAndSetext();
  testIntroWithoutHeading();
  testHtmlDocument();
  testTexteExportRoundTrip();
  testLimits();
  await testExtractUploadedDocument();
  testSpecMatchesPipelineStep();
  testSavedGeoPrompt();
  testUserPromptBlocks();
  testNormalizeKeepsHero();
  testResultAndJobMapping();
  testInputParsing();
  console.log("ok: text-tools geo");
}

void main();
