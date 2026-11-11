/**
 * Texte: the heading level as people see it. The page window and the text export (.txt) put
 * „[H1]“ … „[H4]“ in front of every heading, from the block's `level`; a block without a heading
 * gets no mark. The stored HTML, the HTML export and everything the steps read keep the heading
 * without it. The Markdown export marks only with its switch (`levels=1`). The standalone tools
 * under Verwaltung export as before. No network, no model.
 * Run: npm run test:content-heading-levels
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import { contentStepSpec, currentTextBlock, type ContentPipelineContext } from "../lib/dt/content/pipeline/prompts";
import { rephraseChunkHtml } from "../lib/dt/content/pipeline/rephrase";
import {
  blocksToPromptText,
  headingLevelLabel,
  htmlToMarkdown,
  htmlToPlainText,
  htmlWithHeadingLevels,
  parseBlocksFromHtml,
  renderBlocksHtml,
  type ContentTextBlock,
} from "../lib/dt/content/render";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";

const blocks: ContentTextBlock[] = [
  { id: "intro", heading: "Luxusuhren verkaufen", level: 1, html: "<p>Einstieg.</p>" },
  { id: "hero", heading: null, level: 2, html: "<p>Ein Satz ohne Überschrift.</p>" },
  { id: "ablauf", heading: "So läuft der Ankauf", level: 2, html: "<p>Drei Schritte.</p>" },
  { id: "fotos", heading: "Fotos schicken", level: 3, html: "<p>Zifferblatt und Rückseite.</p>" },
  { id: "papiere", heading: "Box & Papiere", level: 4, html: "<p>Helfen beim Preis.</p>" },
];
const html = renderBlocksHtml(blocks);
const MARK = /\[H[1-4]\]/;

// --- the page window ------------------------------------------------------------------------------
{
  assert.equal(headingLevelLabel(3), "[H3]");
  const shown = htmlWithHeadingLevels(html);
  assert.match(shown, /<section data-block-id="intro"><h1>\[H1\] Luxusuhren verkaufen<\/h1>/);
  assert.match(shown, /<h2>\[H2\] So läuft der Ankauf<\/h2>/);
  assert.match(shown, /<h3>\[H3\] Fotos schicken<\/h3>/);
  assert.match(shown, /<h4>\[H4\] Box &amp; Papiere<\/h4>/);
  assert.match(shown, /<section data-block-id="hero">\n<p>Ein Satz ohne Überschrift\.<\/p><\/section>/, "no heading, no mark");
  assert.equal((shown.match(/\[H[1-4]\]/g) ?? []).length, 4);
  // The mark follows `level`, not the heading's wording.
  const relabelled = htmlWithHeadingLevels(renderBlocksHtml([{ ...blocks[0]! }, { id: "x", heading: "H2 heißt hier nichts", level: 3, html: "<p>x</p>" }]));
  assert.match(relabelled, /<h3>\[H3\] H2 heißt hier nichts<\/h3>/);
  // Every block keeps its id, so the highlights of the page window still find their block.
  for (const b of blocks) assert.ok(shown.includes(`data-block-id="${b.id}"`), b.id);
  // HTML without blocks (an old page) is shown as it is.
  assert.equal(htmlWithHeadingLevels("<p>Alt.</p>"), "<p>Alt.</p>");
  console.log("page window: ok");
}

// --- the exports -----------------------------------------------------------------------------------
{
  const source = { slug: "luxusuhren", title: "Luxusuhren", html, markdown: htmlToMarkdown(html) };
  // What the Texte export route asks for: `.txt` always with marks.
  const txt = contentExportFile("txt", source, { levelLabels: true }).body;
  assert.equal(
    txt,
    "[H1] Luxusuhren verkaufen\n\nEinstieg.\n\nEin Satz ohne Überschrift.\n\n[H2] So läuft der Ankauf\n\nDrei Schritte.\n\n[H3] Fotos schicken\n\nZifferblatt und Rückseite.\n\n[H4] Box & Papiere\n\nHelfen beim Preis.\n",
    "the text export marks every heading, the block without one stays plain",
  );

  // The standalone tools (SEO, GEO, Hormozi, Watermark under Verwaltung) export as before.
  assert.doesNotMatch(contentExportFile("txt", source).body, MARK);

  // Published: no marks, also when asked for.
  assert.doesNotMatch(contentExportFile("html", source, { levelLabels: true }).body, MARK);
  assert.doesNotMatch(contentExportFile("html", source).body, MARK);
  assert.doesNotMatch(contentExportFile("fragment", source).body, MARK);
  assert.match(contentExportFile("html", source).body, /<h2>So läuft der Ankauf<\/h2>/);

  // Markdown: the stored text without marks; with the switch, after the hashes.
  const md = contentExportFile("md", source).body;
  assert.doesNotMatch(md, MARK);
  const marked = contentExportFile("md", source, { levelLabels: true }).body;
  assert.match(marked, /^# \[H1\] Luxusuhren verkaufen$/m);
  assert.match(marked, /^#### \[H4\] Box & Papiere$/m);
  assert.match(marked, /^Ein Satz ohne Überschrift\.$/m);
  assert.equal((marked.match(/\[H[1-4]\]/g) ?? []).length, 4);
  console.log("exports: ok");
}

// --- what the steps read and what is stored: never marked ------------------------------------------
{
  assert.doesNotMatch(html, MARK, "the stored HTML");
  assert.doesNotMatch(htmlToMarkdown(html), MARK, "the stored Markdown");
  assert.doesNotMatch(htmlToPlainText(html), MARK, "plain text as the steps use it");
  assert.doesNotMatch(blocksToPromptText(blocks), MARK);
  assert.doesNotMatch(currentTextBlock({ blocks, title: null, metaDescription: null }), MARK);
  assert.doesNotMatch(rephraseChunkHtml(blocks), MARK, "what Grok gets");
  assert.deepEqual(parseBlocksFromHtml(html).map((b) => b.heading), blocks.map((b) => b.heading));

  const context: ContentPipelineContext = {
    organisationName: "Muster",
    page: {
      name: "Luxusuhren", path: "/uhren", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
      pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
    },
    structureOutline: "",
    existingText: null,
    sections: [{ key: "unternehmen", label: "Unternehmen", current: "Ankauf von Luxusuhren." }],
    settings: { anrede: "Sie", branche: "Handel", tonalitaet: "sachlich", verbotene_woerter: [] },
    avatar: null,
    typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
    notes: [],
    freshness: EMPTY_CONTENT_FRESHNESS,
    outputs: {},
    blocks,
    title: null,
    metaDescription: null,
  };
  for (const step of [3, 4, 6, 7, 8, 10]) {
    assert.doesNotMatch(contentStepSpec(step, context).user, MARK, `step ${step}`);
  }
  console.log("steps and storage: ok");
}

console.log("OK: heading level tests passed");
