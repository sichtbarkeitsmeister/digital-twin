/**
 * Texte: the answer format and the limits of the prompts.
 * - H4: the tools with `blocks` allow level 4, and the page window, the HTML, Markdown and text
 *   exports and the Watermark Entfernung keep an H4 an H4. Before, the stored `<h4>` was not
 *   read back as a heading and its words ended up in the Abschnitt's text.
 * - A block without a heading is a section without a heading tag, in every format.
 * - An earlier step's result is never cut inside an entry any more (it was at 12,000 characters,
 *   which dropped the Analyse's belegte Fakten at its end).
 * - Customer answers up to 4,000 characters, the live page's text up to 20,000.
 * - The fixed base rules as the agency set them on 10.11.
 * No network, no model.
 * Run: npm run test:content-format-limits
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { ANSWERS_TOOL } from "../lib/dt/content/pipeline/answers";
import { AKTUALITAET_TOOL, aktualitaetSystemPrompt } from "../lib/dt/content/pipeline/aktualitaet";
import {
  BASE_RULES,
  BLOCKS_SCHEMA,
  GEO_TOOL,
  MAX_OUTPUT_CHARS,
  QUESTION_RULES,
  TEXT_TOOL_SCHEMA,
  contentStepSpec,
  normalizeTextOutput,
  shrinkStepOutput,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import { parseRephrasedChunk, rephraseChunkHtml } from "../lib/dt/content/pipeline/rephrase";
import { CONTENT_STEPS } from "../lib/dt/content/pipeline/steps";
import { extractContentBlocks } from "../lib/dt/content/presentation";
import {
  blocksToPromptText,
  htmlToMarkdown,
  htmlToPlainText,
  parseBlocksFromHtml,
  renderBlocksHtml,
  type ContentTextBlock,
} from "../lib/dt/content/render";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const context = (patch: Partial<ContentPipelineContext> = {}): ContentPipelineContext => ({
  organisationName: "Muster GmbH",
  page: {
    name: "Unterseite", path: "/leistung/unterseite", level: 2, url: "https://example.com/leistung/unterseite", source: "crawl", page_role: null, page_type: "unterseite",
    pillar_name: "Leistung", estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "unternehmen", label: "Unternehmen", current: "Wir sind ein Betrieb." }],
  settings: { anrede: "Sie", branche: "Handwerk", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks: [{ id: "intro", heading: "H1", level: 1, html: "<p>Text.</p>" }],
  title: null,
  metaDescription: null,
  ...patch,
});

// --- H4 in every tool with blocks ----------------------------------------------------------------
{
  assert.deepEqual(BLOCKS_SCHEMA.items.properties.level.enum, [1, 2, 3, 4]);
  assert.match(BLOCKS_SCHEMA.description, /bei Bedarf H3 \(level 3\) und H4 \(level 4\)\. Bestehende ids beibehalten\.$/);
  type Schema = { properties: { blocks: { items: { properties: { level: { enum: number[] } } } } } };
  const levels = (schema: unknown) => (schema as Schema).properties.blocks.items.properties.level.enum;
  assert.deepEqual(levels(TEXT_TOOL_SCHEMA), [1, 2, 3, 4]);
  assert.deepEqual(levels(GEO_TOOL.input_schema), [1, 2, 3, 4]);
  assert.deepEqual(levels(AKTUALITAET_TOOL.input_schema), [1, 2, 3, 4]);
  assert.deepEqual(levels(ANSWERS_TOOL.input_schema), [1, 2, 3, 4]);
  for (const key of ["seo", "geo", "hormozi", "vermenschlichung", "lektorat"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    assert.deepEqual(levels(contentStepSpec(def.step, context()).tool.input_schema), [1, 2, 3, 4], def.name);
  }
  console.log("level 4 in the tools: ok");
}

// --- H4 and a block without a heading, through every format ----------------------------------------
{
  const answer = {
    title: "T",
    meta_description: "M",
    blocks: [
      { id: "intro", heading: "Klaviertransport", level: 1, html: "<p>Einstieg.</p>" },
      { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>So läuft es.</p>" },
      { id: "termin", heading: "Der Termin", level: 3, html: "<p>Wir kommen.</p>" },
      { id: "treppenhaus", heading: "Enge Treppenhäuser", level: 4, html: "<p>Wir messen vorher aus, damit am Tag selbst nichts hängen bleibt.</p>" },
      { id: "ohne", heading: "", level: 2, html: "<p>Ein Abschnitt ohne Überschrift.</p>" },
      { id: "tief", heading: "Zu tief", level: 5, html: "<p>x</p>" },
    ],
  };
  const blocks = normalizeTextOutput(answer, { blocks: [], title: null, metaDescription: null }).blocks;
  assert.deepEqual(blocks.map((b) => b.level), [1, 2, 3, 4, 2, 2], "level 4 is kept; anything else falls back to 2");
  assert.equal(blocks[4]!.heading, null, "an empty heading is stored as none");

  const html = renderBlocksHtml(blocks);
  assert.match(html, /<section data-block-id="treppenhaus"><h4>Enge Treppenhäuser<\/h4>\n<p>Wir messen/);
  assert.match(html, /<section data-block-id="ohne">\n<p>Ein Abschnitt ohne Überschrift\.<\/p><\/section>/, "no heading tag, no empty <h2>");

  // Stored and read back (every later step and „Abschnitt ändern“ do this).
  const back = parseBlocksFromHtml(html);
  assert.deepEqual(back, blocks, "the stored HTML reads back as the same blocks, H4 included");
  assert.equal(back[3]!.html, "<p>Wir messen vorher aus, damit am Tag selbst nichts hängen bleibt.</p>", "the heading is not part of the body");

  // What the next step reads, the Markdown and the text export.
  assert.match(blocksToPromptText(back), /\[Abschnitt treppenhaus\]\n#### Enge Treppenhäuser\nWir messen/);
  assert.match(blocksToPromptText(back), /\[Abschnitt ohne\]\nEin Abschnitt ohne Überschrift\./);
  assert.match(htmlToMarkdown(html), /### Der Termin\n\nWir kommen\.\n\n#### Enge Treppenhäuser\n\nWir messen/);
  assert.match(htmlToPlainText(html), /Der Termin\n\nWir kommen\.\n\nEnge Treppenhäuser\n\nWir messen[^\n]*\n\nEin Abschnitt ohne Überschrift\./);
  assert.doesNotMatch(htmlToPlainText(html), /<|#/);

  // The four exports.
  const source = { slug: "klavier", title: "Klaviertransport", html };
  assert.match(contentExportFile("html", source).body, /<body>[\s\S]*<h4>Enge Treppenhäuser<\/h4>[\s\S]*<\/body>/);
  assert.match(contentExportFile("fragment", source).body, /<h4>Enge Treppenhäuser<\/h4>/);
  assert.match(contentExportFile("md", source).body, /#### Enge Treppenhäuser/);
  assert.match(contentExportFile("txt", source).body, /\nEnge Treppenhäuser\n/);

  // The page window's editable blocks: heading and text, one block per section.
  const shown = extractContentBlocks(html);
  assert.equal(shown.find((b) => b.id === "treppenhaus")!.text, "Enge Treppenhäuser\n\nWir messen vorher aus, damit am Tag selbst nichts hängen bleibt.");
  assert.equal(shown.find((b) => b.id === "termin")!.text, "Der Termin\n\nWir kommen.", "an H4 block reads like an H3 block");
  assert.equal(shown.find((b) => b.id === "ohne")!.text, "Ein Abschnitt ohne Überschrift.");

  // Watermark Entfernung: the chunk goes out with its <h4>, the answer's body comes back, the
  // heading and its level stay as they were.
  const chunk = [back[3]!, back[4]!];
  assert.match(rephraseChunkHtml(chunk), /<h4>Enge Treppenhäuser<\/h4>/);
  const grok = `<section data-block-id="treppenhaus"><h4>Enge Treppen</h4>\n<p>Vorher messen wir aus, damit am Umzugstag nichts klemmt.</p></section>\n<section data-block-id="ohne">\n<p>Ein Abschnitt, der keine Überschrift hat.</p></section>`;
  const rewritten = parseRephrasedChunk(grok, chunk);
  assert.deepEqual(rewritten.map((b: ContentTextBlock) => [b.heading, b.level, b.html]), [
    ["Enge Treppenhäuser", 4, "<p>Vorher messen wir aus, damit am Umzugstag nichts klemmt.</p>"],
    [null, 2, "<p>Ein Abschnitt, der keine Überschrift hat.</p>"],
  ]);
  // A single section answered as bare paragraphs under an <h4>.
  const bare = parseRephrasedChunk("<h4>Enge Treppenhäuser</h4>\n<p>Vorher wird ausgemessen, damit am Umzugstag alles passt.</p>", [back[3]!]);
  assert.deepEqual([bare[0]!.level, bare[0]!.html], [4, "<p>Vorher wird ausgemessen, damit am Umzugstag alles passt.</p>"]);
  console.log("H4 and blocks without a heading: ok");
}

// --- an earlier step's result: whole entries, never cut inside one --------------------------------
{
  const long = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}: ${"Text ".repeat(60)}`);
  const analyse = {
    main_keyword: "klaviertransport",
    fanout_questions: Array.from({ length: 30 }, (_, i) => ({ question: `Frage ${i + 1}? ${"x".repeat(300)}`, source: "Recherche", theme: "t" })),
    deferred_questions: Array.from({ length: 20 }, (_, i) => ({ question: `Verschoben ${i + 1} ${"x".repeat(300)}`, link_to: "Seite", short_answer_hint: "h" })),
    dropped_questions: Array.from({ length: 20 }, (_, i) => ({ question: `Verworfen ${i + 1} ${"x".repeat(300)}`, reason: "passt nicht" })),
    usable_facts: long("Belegter Fakt", 40),
    missing_facts: long("Fehlt", 20),
    assumptions: long("Annahme", 20),
  };
  assert.ok(JSON.stringify(analyse, null, 1).length > MAX_OUTPUT_CHARS);
  assert.equal(MAX_OUTPUT_CHARS, 40_000);

  const { json, dropped } = shrinkStepOutput(analyse);
  assert.ok(json.length <= MAX_OUTPUT_CHARS);
  const kept = JSON.parse(json) as typeof analyse;
  assert.equal(kept.usable_facts.length, 40, "the belegte Fakten are never shortened");
  assert.deepEqual(kept.usable_facts, analyse.usable_facts);
  assert.equal(kept.dropped_questions.length, 0, "the dropped questions go first");
  assert.ok(dropped.dropped_questions === 20 && (dropped.assumptions ?? 0) > 0);
  assert.equal(dropped.fanout_questions, undefined, "the questions the text must cover are still all there");
  assert.equal(kept.fanout_questions.length, 30);

  const seo = contentStepSpec(2, context({ outputs: { 1: analyse } })).user;
  assert.match(seo, /… \(gekürzt: ganze Einträge weggelassen – dropped_questions: 20, assumptions: \d+/);
  assert.ok(seo.includes("Belegter Fakt 40:"), "the last belegte Fakt reaches the SEO prompt");
  const block = seo.slice(seo.indexOf("## Analyse"), seo.indexOf("… (gekürzt"));
  assert.doesNotThrow(() => JSON.parse(block.slice(block.indexOf("{"))), "what is quoted is whole JSON");

  // A result that fits is quoted as it is, without a note.
  const small = { main_keyword: "k", usable_facts: ["a"], assumptions: ["b"] };
  assert.deepEqual(shrinkStepOutput(small), { json: JSON.stringify(small, null, 1), dropped: {} });
  assert.ok(!contentStepSpec(2, context({ outputs: { 1: small } })).user.includes("gekürzt"));

  // Only the belegte Fakten left to cut: they stay, even over the limit.
  const onlyFacts = { usable_facts: long("Fakt", 200) };
  assert.equal((JSON.parse(shrinkStepOutput(onlyFacts).json) as typeof onlyFacts).usable_facts.length, 200);
  console.log("earlier results: ok");
}

// --- customer answers and the live page's text -----------------------------------------------------
{
  const answer = `${"Preisliste Position. ".repeat(180)}ENDE DER ANTWORT`;
  assert.ok(answer.length > 3_000 && answer.length < 4_000);
  const seo = contentStepSpec(2, context({ customerAnswers: [{ question: "Was kostet es?", answer }] })).user;
  assert.ok(seo.includes("ENDE DER ANTWORT"), "an answer of 3,800 characters is whole (it was cut at 1,000)");
  const tooLong = contentStepSpec(2, context({ customerAnswers: [{ question: "Was kostet es?", answer: `${"x".repeat(4_100)}ENDE` }] })).user;
  assert.ok(!tooLong.includes("ENDE") && tooLong.includes("… (gekürzt)"));

  const live = `${"Satz der Live-Seite. ".repeat(900)}ENDE DER LIVE-SEITE`;
  assert.ok(live.length > 18_000 && live.length < 20_000);
  const withLive = contentStepSpec(2, context({ existingText: live })).user;
  assert.ok(withLive.includes("ENDE DER LIVE-SEITE"), "19,000 characters of the live page are whole (it was cut at 6,000)");
  console.log("answers and live text: ok");
}

// --- the fixed base rules ----------------------------------------------------------------------------
{
  assert.equal(
    BASE_RULES,
    `Du arbeitest für eine Agentur, die Webseitentexte für kleine Unternehmen schreibt. Sprache: Deutsch.
Tatsachen über den Anbieter (Leistungen, Zahlen, Namen, Preise, Abläufe, Orte, Zusagen) kommen ausschließlich aus den Anbieterfakten, dem Faktenauszug, den Antworten des Kunden, den Kontaktdaten und den Anmerkungen der Redaktion. Bei Widerspruch gehen die Anbieterfakten dem Faktenauszug vor. Was im Block „Gesperrt“ steht, wird nicht verwendet, auch nicht sinngemäß. Nichts erfinden.
Allgemeines Fachwissen zur Leistung ist erlaubt, z. B. welche Merkmale den Wert eines Objekts üblicherweise bestimmen, wenn es keine Aussage über den Anbieter ist und keine Zahl, Frist, Rechtsaussage oder zeitkritische Angabe enthält.
Fehlt eine Angabe über den Anbieter, gilt die feste Regel zu Fragen und Platzhaltern.
Anrede, Tonalität und verbotene Wörter aus den Vorgaben gelten ohne Ausnahme.`,
  );
  for (const key of ["analyse", "seo", "faktencheck", "geo", "hormozi", "vermenschlichung", "lektorat", "endabnahme"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    assert.ok(contentStepSpec(def.step, context()).system.includes(BASE_RULES), `${def.name} carries the base rules`);
  }
  // The base rules point to the rule on questions and placeholders: the Analyse and the
  // Endabnahme carry it now too, the Aktualitätsprüfung does not.
  for (const key of ["analyse", "seo", "faktencheck", "geo", "hormozi", "vermenschlichung", "lektorat", "endabnahme"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    const system = contentStepSpec(def.step, context()).system;
    assert.ok(system.includes(QUESTION_RULES), `${def.name} carries the rule on questions and placeholders`);
    assert.equal(system.split(QUESTION_RULES).length, 2, `${def.name}: once`);
  }
  assert.ok(!aktualitaetSystemPrompt(context()).includes(QUESTION_RULES), "not the Aktualitätsprüfung");
  console.log("base rules: ok");
}

console.log("OK: format and limits tests passed");
