/**
 * Texte: the SEO-H1 and the hero section as the agency's Textvorlagen set them (for every
 * organisation): step 2 writes first the block `hero` (level 1, heading = the short SEO-H1, html
 * empty), then `zusammenfassung` (level 2, heading = the Hero-Überschrift). The code used to drop
 * that `hero` block, promote `zusammenfassung` to the H1 and insert an empty hero slot, so the
 * page had no SEO-H1 and the Hero-Überschrift as its H1 (Luxus-Uhren Ankauf, 11.11.).
 * Now: a heading-only block stays everywhere, no level is overwritten, a text without an H1 is
 * reported. The older recipe (hero as a slot Hormozi fills) still works. No network, no model.
 * Run: npm run test:content-hero-h1
 */
import assert from "node:assert/strict";

import { contentExportFile } from "../lib/dt/content/export";
import { EMPTY_CONTENT_FRESHNESS } from "../lib/dt/content/freshness";
import {
  BLOCKS_SCHEMA,
  CONTENT_HERO_PLACEHOLDER,
  SEO_BLOCKS_DESCRIPTION,
  TEXT_TOOL_SCHEMA,
  contentStepSpec,
  ensureHeroPlaceholder,
  keepHeroBlock,
  missingH1Finding,
  settleHeroSentence,
  type ContentPipelineContext,
} from "../lib/dt/content/pipeline/prompts";
import { rephraseBlockCount } from "../lib/dt/content/pipeline/rephrase";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import { CONTENT_STEPS, contentStepDefinition } from "../lib/dt/content/pipeline/steps";
import { extractContentBlocks } from "../lib/dt/content/presentation";
import {
  blocksToPromptText,
  htmlToMarkdown,
  htmlToPlainText,
  htmlWithHeadingLevels,
  normalizeBlocks,
  parseBlocksFromHtml,
  renderBlocksHtml,
  type ContentTextBlock,
} from "../lib/dt/content/render";
import { DEFAULT_CONTENT_TYPE_PROMPTS } from "../lib/dt/content/type-prompts";
import type { ContentFinding } from "../lib/dt/content/types";

/** What step 2 delivers under the current Textvorlagen (any organisation). */
const answer = {
  title: "Luxusuhren verkaufen Düsseldorf",
  meta_description: "Ankauf von Luxusuhren.",
  blocks: [
    { id: "hero", heading: "Luxusuhren Ankauf Düsseldorf", level: 1, html: "" },
    { id: "zusammenfassung", heading: "Ihre Uhr, nachvollziehbar bewertet und sicher übergeben", level: 2, html: "<p>Sie besitzen eine Rolex …</p>" },
    { id: "trust", heading: "", level: 2, html: "<ul><li>Seit 2009 in Düsseldorf</li></ul>" },
    { id: "ergebnis", heading: "Am Ende wissen Sie, warum der Preis stimmt", level: 2, html: "<p>Text.</p>" },
  ],
};

const context = (blocks: ContentTextBlock[] = []): ContentPipelineContext => ({
  organisationName: "Muster GmbH",
  page: {
    name: "Leistung", path: "/leistung", level: 2, url: null, source: "structure", page_role: "supporting", page_type: "unterseite",
    pillar_name: null, estimated_traffic: null, keywords: null, h1_options: [], user_questions: [], ki_prompt: null, internal_link_targets: [],
  },
  structureOutline: "",
  existingText: null,
  sections: [{ key: "unternehmen", label: "Unternehmen", current: "Ein Betrieb." }],
  settings: { anrede: "Sie", branche: "Handel", tonalitaet: "sachlich", verbotene_woerter: [] },
  avatar: null,
  typePrompts: { ...DEFAULT_CONTENT_TYPE_PROMPTS },
  notes: [],
  freshness: EMPTY_CONTENT_FRESHNESS,
  outputs: {},
  blocks,
  title: null,
  metaDescription: null,
});

// --- 1./3. step 2 keeps the SEO-H1 and every level --------------------------------------------------
const seo = contentStepSpec(2, context());
const out = seo.normalize(answer, context()) as { blocks: ContentTextBlock[] };
{
  assert.deepEqual(
    out.blocks.map((b) => [b.id, b.level, b.heading, b.html]),
    [
      ["hero", 1, "Luxusuhren Ankauf Düsseldorf", ""],
      ["zusammenfassung", 2, "Ihre Uhr, nachvollziehbar bewertet und sicher übergeben", "<p>Sie besitzen eine Rolex …</p>"],
      ["trust", 2, null, "<ul><li>Seit 2009 in Düsseldorf</li></ul>"],
      ["ergebnis", 2, "Am Ende wissen Sie, warum der Preis stimmt", "<p>Text.</p>"],
    ],
    "the SEO-H1 stays, the Hero-Überschrift stays an H2, no slot is inserted",
  );
  assert.ok(!out.blocks.some((b) => b.heading === CONTENT_HERO_PLACEHOLDER));
  // normalizeBlocks itself: a heading-only first block keeps level 1; a first block with level 2 stays 2.
  assert.deepEqual(normalizeBlocks([{ id: "a", heading: "A", level: 2, html: "" }]).map((b) => b.level), [2]);
  assert.deepEqual(normalizeBlocks([{ id: "a", heading: "", level: 1, html: "" }]), [], "nothing at all: dropped as before");
  console.log("step 2 keeps the H1: ok");
}

// --- 2. a block with a heading and empty html, through display, storage and every export -----------
{
  const html = renderBlocksHtml(out.blocks);
  assert.match(html, /^<section data-block-id="hero"><h1>Luxusuhren Ankauf Düsseldorf<\/h1><\/section>/);
  assert.deepEqual(parseBlocksFromHtml(html), out.blocks, "stored and read back whole");
  assert.match(htmlWithHeadingLevels(html), /<h1>\[H1\] Luxusuhren Ankauf Düsseldorf<\/h1>/, "page window");
  assert.equal(extractContentBlocks(html)[0]!.text, "Luxusuhren Ankauf Düsseldorf");
  assert.match(contentExportFile("html", { slug: "s", title: "t", html }).body, /<h1>Luxusuhren Ankauf Düsseldorf<\/h1>/);
  assert.match(contentExportFile("txt", { slug: "s", title: "t", html }, { levelLabels: true }).body, /^\[H1\] Luxusuhren Ankauf Düsseldorf\n\n\[H2\] Ihre Uhr/);
  assert.match(htmlToMarkdown(html), /^# Luxusuhren Ankauf Düsseldorf\n\n## Ihre Uhr/);
  assert.match(htmlToPlainText(html), /^Luxusuhren Ankauf Düsseldorf\n\nIhre Uhr/);
  assert.match(blocksToPromptText(out.blocks), /^\[Abschnitt hero\]\n# Luxusuhren Ankauf Düsseldorf\n\n\[Abschnitt zusammenfassung\]/, "what the next steps read");
  assert.equal(rephraseBlockCount(out.blocks.slice(0, 1)), 0, "Watermark leaves a heading-only block alone");
  console.log("heading-only block everywhere: ok");
}

// --- later steps keep the hero H1 ------------------------------------------------------------------
{
  const dropped = keepHeroBlock(out.blocks.filter((b) => b.id !== "hero").map((b, i) => (i === 0 ? { ...b, level: 1 as const } : b)), out.blocks);
  assert.deepEqual(dropped.slice(0, 2).map((b) => [b.id, b.level]), [["hero", 1], ["zusammenfassung", 2]], "back as the first block, the only H1");
  assert.deepEqual(settleHeroSentence(out.blocks)[0], out.blocks[0], "Hormozi does not turn the H1 into a sentence");
  for (const key of ["geo", "hormozi", "vermenschlichung", "lektorat"] as const) {
    const def = CONTENT_STEPS.find((s) => s.key === key)!;
    const spec = contentStepSpec(def.step, context(out.blocks));
    const kept = spec.normalize({ blocks: answer.blocks }, context(out.blocks)) as { blocks: ContentTextBlock[] };
    assert.deepEqual(kept.blocks.slice(0, 2).map((b) => [b.id, b.level, b.heading]), [["hero", 1, "Luxusuhren Ankauf Düsseldorf"], ["zusammenfassung", 2, answer.blocks[1]!.heading]], def.name);
  }
  console.log("later steps: ok");
}

// --- 3. no H1: a finding, no promotion -----------------------------------------------------------------
{
  const noH1 = [{ ...answer.blocks[1]!, level: 2 }, ...answer.blocks.slice(2)];
  const normalized = (seo.normalize({ blocks: noH1 }, context()) as { blocks: ContentTextBlock[] }).blocks;
  assert.ok(!normalized.some((b) => b.level === 1), "the Hero-Überschrift is not made the H1");
  const finding = missingH1Finding(normalized)!;
  assert.equal(finding.title, "H1 fehlt");
  assert.equal(finding.severity, "high");
  assert.match(finding.problem, /Der erste Abschnitt ist „Ihre Uhr, nachvollziehbar bewertet und sicher übergeben“ auf Ebene 2\. Es wurde keine andere Überschrift zur H1 hochgestuft\./);
  assert.equal(missingH1Finding(out.blocks), null);

  // The step's patch: the finding on the page, once; gone again when a later text has an H1.
  const def = contentStepDefinition(2)!;
  const patch = stepPatchFor(def, { blocks: normalized, title: null, meta_description: null }, { html: "", findings: [] });
  const findings = patch.pagePatch.findings as ContentFinding[];
  assert.deepEqual(findings.map((f) => f.title), ["H1 fehlt"]);
  const again = stepPatchFor(contentStepDefinition(7)!, { blocks: normalized, title: null, meta_description: null }, { html: renderBlocksHtml(normalized), findings });
  assert.equal((again.pagePatch.findings as ContentFinding[] | undefined ?? findings).filter((f) => f.title === "H1 fehlt").length, 1, "not twice");
  const fixed = stepPatchFor(contentStepDefinition(7)!, { blocks: out.blocks, title: null, meta_description: null }, { html: renderBlocksHtml(normalized), findings });
  assert.deepEqual(fixed.pagePatch.findings, [], "an H1 again: the finding goes");
  console.log("missing H1 reported: ok");
}

// --- the older recipe still works: hero as the slot under the first block ---------------------------
{
  const older = ensureHeroPlaceholder([
    { id: "intro", heading: "Privatumzug Köln", level: 1, html: "" },
    { id: "ablauf", heading: "Ablauf", level: 2, html: "<p>So.</p>" },
  ]);
  assert.deepEqual(older.map((b) => [b.id, b.level, b.heading]), [["intro", 1, "Privatumzug Köln"], ["hero", 2, CONTENT_HERO_PLACEHOLDER], ["ablauf", 2, "Ablauf"]]);
  assert.deepEqual(settleHeroSentence([older[0]!, { ...older[1]!, heading: "Endlich umziehen", html: "" }])[1], { id: "hero", heading: null, level: 2, html: "<p><strong>Endlich umziehen</strong></p>" });
  console.log("older recipe: ok");
}

// --- 4. the description of blocks in submit_seo_text -----------------------------------------------------
{
  type Schema = { properties: { blocks: { description: string; items: unknown } } };
  const schema = seo.tool.input_schema as unknown as Schema;
  assert.equal(seo.tool.name, "submit_seo_text");
  assert.ok(
    schema.properties.blocks.description.includes(
      "Der erste Block (id hero) trägt die kurze SEO-H1 (level 1, html darf leer sein), der zweite (id zusammenfassung) die Hero-Überschrift als H2.",
    ),
  );
  assert.equal(schema.properties.blocks.description, SEO_BLOCKS_DESCRIPTION);
  assert.deepEqual(schema.properties.blocks.items, BLOCKS_SCHEMA.items, "same fields as every other text tool");
  assert.equal((TEXT_TOOL_SCHEMA as unknown as Schema).properties.blocks.description, BLOCKS_SCHEMA.description, "the other tools keep theirs");
  console.log("tool description: ok");
}

console.log("OK: hero H1 tests passed");
