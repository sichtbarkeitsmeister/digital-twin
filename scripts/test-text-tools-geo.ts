/**
 * GEO tool (Verwaltung → GEO): file ingestion → blocks, and the standalone prompt: the GEO
 * instruction from Globale Prompts, Anbieterfakten and the chosen avatar; nothing from Texte's
 * settings, Seitenstruktur, Analyse or Faktencheck. Mocked model, no network, no database.
 * Run: npx tsx scripts/test-text-tools-geo.ts
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { ContentLlmError } from "../lib/dt/content/pipeline/llm";
import { CONTENT_HERO_BLOCK_ID, CONTENT_HERO_PLACEHOLDER, GEO_TOOL, TEXT_TOOL_SCHEMA } from "../lib/dt/content/pipeline/prompts";
import { renderBlocksHtml } from "../lib/dt/content/render";
import { DEFAULT_CONTENT_STEP_PROMPTS } from "../lib/dt/content/step-prompts";
import {
  GEO_TOOL_NO_PRIOR_STEPS,
  GEO_TOOL_RULES,
  geoToolInstruction,
  geoToolRequestSchema,
  geoToolSpec,
  runGeoOnContext,
  type GeoToolContext,
  type GeoToolModelCall,
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
    avatar: { name: "Anna", role: "Patientin", beschreibung: "45, berufstätig." },
    geoPrompt: null,
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
    ...extra,
  };
}

/** Without a saved text the instruction is the Globale-Prompts default; the tool's own rules follow. */
function testSystemPromptUsesGlobalGeoPrompt() {
  const spec = geoToolSpec(toolContext());
  const instruction = geoToolInstruction(toolContext());
  assert.equal(instruction, DEFAULT_CONTENT_STEP_PROMPTS.geo, "the GEO default has no {{…}} variables");
  assert.equal(spec.system, `${instruction}\n\n${GEO_TOOL_RULES}`, "instruction first, then the fixed rules, nothing else");
  assert.match(spec.system, /^Schritt 4 GEO/);
  // Nothing from Texte's settings: no Vorgaben, no Branchenregel, no Anrede rule from the settings.
  assert.doesNotMatch(spec.system, /Branchenregel|aus den Vorgaben gelten/);
  assert.doesNotMatch(spec.system, /\{\{/, "no unfilled variable");
  assert.deepEqual(spec.tool, GEO_TOOL);
  assert.equal(spec.tool.name, "submit_geo_text");
  assert.deepEqual(spec.tool.input_schema, TEXT_TOOL_SCHEMA);
  assert.equal(spec.maxTokens, 12_000);
  console.log("system prompt from Globale Prompts: ok");
}

/** A text saved under Globale Prompts → GEO replaces the default; variables are filled. */
function testSavedGlobalGeoPromptWins() {
  const own = "Eigene GEO-Anweisung für {{firmenname}}: Antworten zuerst. {{unbekannt}}";
  const spec = geoToolSpec(toolContext({ geoPrompt: own }));
  assert.ok(spec.system.startsWith("Eigene GEO-Anweisung für Praxis Dr. Test: Antworten zuerst. {{unbekannt}}\n\n"), spec.system.slice(0, 120));
  assert.doesNotMatch(spec.system, /Schritt 4 GEO/, "the default instruction is replaced");
  assert.ok(spec.system.endsWith(GEO_TOOL_RULES));
  assert.equal(geoToolSpec(toolContext({ geoPrompt: "   " })).system, geoToolSpec(toolContext()).system, "empty means the default");
  assert.match(geoToolInstruction({ organisationName: "", geoPrompt: "Für {{firmenname}}." }), /^Für \[Firmenname\]\.$/);
  console.log("saved Globale-Prompts GEO text wins: ok");
}

/** The message holds the page label, the text, Anbieterfakten and the avatar – nothing else. */
function testUserPromptOnlyTextAnbieterfaktenAndAvatar() {
  const user = geoToolSpec(toolContext({ title: "Zahnarzt Münster", metaDescription: "Praxis in Münster." })).user;
  assert.match(user, /^## Seite\nOrganisation: Praxis Dr\. Test\nSeite: Leistungen\nQuelle: hochgeladene Datei „leistungen\.docx“/);
  assert.ok(user.includes(GEO_TOOL_NO_PRIOR_STEPS));
  assert.match(user, /## Aktueller Text \(Abschnitte mit ihrer id\)\nTitle-Tag: Zahnarzt Münster\nMeta-Description: Praxis in Münster\./);
  assert.match(user, /\[Abschnitt abschnitt-1\]\n# Zahnarzt in Münster\nWir behandeln\./);
  assert.match(user, /## Anbieterfakten aus Fragebogen und Kundengesprächen[\s\S]*### Leistungen\nProphylaxe und Implantate in Münster\./);
  assert.match(user, /## Avatar \(Wunschkunde[\s\S]*Name: Anna\nRolle: Patientin\n45, berufstätig\./);
  // Removed inputs and Texte-only parts never appear.
  assert.doesNotMatch(user, /## Vorgaben|## Anmerkungen der Redaktion|## Analyse \(Schritt 1\)|## Faktencheck \(Schritt 3\)|Seitenstruktur \(|Weitere Seiten der Website/);
  const order = ["## Seite", "## Vorschritte", "## Aktueller Text", "## Anbieterfakten", "## Avatar"].map((h) => user.indexOf(h));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "blocks in a fixed order");

  const bare = geoToolSpec(toolContext({ pageName: null, avatar: null, sections: [] })).user;
  assert.doesNotMatch(bare, /^Seite:/m, "no page label without a Seitenname");
  assert.match(bare, /## Anbieterfakten\n\(keine\)/);
  assert.match(bare, /## Avatar \(Wunschkunde\)\n\(kein Avatar hinterlegt\)/);
  console.log("user prompt only text, Anbieterfakten and avatar: ok");
}

const answer = {
  title: "",
  meta_description: "Neu.",
  blocks: [
    { id: "abschnitt-1", heading: "Zahnarzt in Münster", level: 1, html: "<p>Die Praxis Dr. Test behandelt in Münster.</p><script>x</script>" },
    { id: "abschnitt-2", heading: "Prophylaxe", level: 2, html: "<p>Alle sechs Monate.</p>" },
    { id: "stand", heading: "", level: 2, html: "<p>Zuletzt aktualisiert: [DATUM]</p>" },
  ],
};

/** One model call with the spec; the dropped hero block returns; the result renders and exports. */
async function testRunOneCall() {
  const calls: Parameters<GeoToolModelCall>[0][] = [];
  const call: GeoToolModelCall = async (input) => {
    calls.push(input);
    return { json: answer, usage: { inputTokens: 1_000, outputTokens: 2_000 }, model: "claude-sonnet-4-6" };
  };
  const context = toolContext();
  const { result, usage } = await runGeoOnContext(context, { models: ["claude-sonnet-4-6"], call });
  assert.equal(calls.length, 1, "exactly one model call");
  const spec = geoToolSpec(context);
  assert.equal(calls[0]!.system, spec.system);
  assert.equal(calls[0]!.user, spec.user);
  assert.equal(calls[0]!.tool.name, "submit_geo_text");
  assert.equal(calls[0]!.timeoutMs, 270_000);
  assert.deepEqual(usage, { model: "claude-sonnet-4-6", inputTokens: 1_000, outputTokens: 2_000 });

  assert.deepEqual(result.blocks.map((b) => b.id), ["abschnitt-1", CONTENT_HERO_BLOCK_ID, "abschnitt-2", "stand"], "the dropped hero block returns after the H1");
  assert.doesNotMatch(result.blocks[0]!.html, /<script>/);
  assert.equal(result.title, null, "empty title keeps the upload's (none)");
  assert.equal(result.meta_description, "Neu.");
  assert.equal(result.avatar_name, "Anna");
  assert.equal(result.page_name, "Leistungen");
  assert.equal(result.file_name, "leistungen.docx");
  assert.equal(result.input_blocks, 3);
  assert.ok(result.cost_eur > 0);
  assert.equal(result.html, renderBlocksHtml(result.blocks));

  const html = contentExportFile("html", { slug: "leistungen-geo", title: "Leistungen", html: result.html });
  assert.equal(html.filename, "leistungen-geo.html");
  assert.match(html.body, /^<!DOCTYPE html>[\s\S]*<title>Leistungen<\/title>[\s\S]*<h1>Zahnarzt in Münster<\/h1>/);
  const txt = contentExportFile("txt", { slug: "leistungen-geo", title: "Leistungen", html: result.html });
  assert.equal(txt.filename, "leistungen-geo.txt");
  assert.match(txt.body, /^Zahnarzt in Münster\n\nDie Praxis Dr\. Test behandelt in Münster\./);
  assert.doesNotMatch(txt.body, /<[a-z]/);
  console.log("run: one call, normalised result, HTML and .txt export: ok");
}

/** An answer without blocks is an error, not the upload handed back as if reworked. */
async function testEmptyAnswerIsAnError() {
  const call: GeoToolModelCall = async () => ({ json: { blocks: [] }, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" });
  await assert.rejects(
    runGeoOnContext(toolContext(), { models: ["m"], call }),
    (error: unknown) => error instanceof ContentLlmError && error.retryable && /keinen überarbeiteten Text/.test(error.message),
  );
  console.log("empty answer is an error: ok");
}

function testRequestSchema() {
  const base = {
    organisationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    fileName: "a.txt",
    pageName: null,
    avatarId: null,
    blocks: uploadBlocks,
    title: null,
    metaDescription: null,
  };
  assert.ok(geoToolRequestSchema.safeParse(base).success);
  assert.ok(geoToolRequestSchema.safeParse({ ...base, pageName: "Leistungen", avatarId: "33333333-3333-4333-8333-333333333333" }).success);
  assert.equal(geoToolRequestSchema.safeParse({ ...base, avatarId: "kein-uuid" }).success, false);
  assert.equal(geoToolRequestSchema.safeParse({ ...base, blocks: [] }).success, false);
  assert.equal(geoToolRequestSchema.safeParse({}).success, false);
  // Removed inputs are not part of the request any more.
  const parsed = geoToolRequestSchema.parse({ ...base, notes: ["x"], questions: ["y"], faktencheck: {} });
  assert.ok(!("notes" in parsed) && !("questions" in parsed) && !("faktencheck" in parsed));
  console.log("request schema: ok");
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
  testSystemPromptUsesGlobalGeoPrompt();
  testSavedGlobalGeoPromptWins();
  testUserPromptOnlyTextAnbieterfaktenAndAvatar();
  await testRunOneCall();
  await testEmptyAnswerIsAnError();
  testRequestSchema();
  console.log("ok: text-tools geo");
}

void main();
