/**
 * Lenient reading of tool inputs: Claude sometimes sends a nested parameter (the text
 * sections of a page) as a JSON string, with unescaped quotes inside. Before this, the SEO
 * step of Texte and the SEO tool threw such answers away („Die KI hat keinen Text geliefert“).
 * Run: npx tsx scripts/test-tolerant-tool-input.ts
 */
import assert from "node:assert/strict";

import { parseJsonLenient, repairJsonText, reviveStringifiedToolInput } from "../lib/ai/tolerant-json";
import { TEXT_TOOL_SCHEMA } from "../lib/dt/content/pipeline/prompts";
import { normalizeBlocks } from "../lib/dt/content/render";
import { normalizeSeoToolOutput } from "../lib/dt/text-tools/seo";

/** What the model actually sent: the blocks array as a string, a German quote closed with ASCII. */
const STRINGIFIED_BLOCKS = `[
  {
    "id": "h1",
    "heading": "Badsanierung in Münster",
    "level": 1,
    "html": ""
  },
  {
    "id": "fragen",
    "heading": "Was Kunden vorher fragen",
    "level": 2,
    "html": "<p><strong>„Muss ich während der Sanierung ausziehen?"</strong><br>Nein. Wir arbeiten raumweise.</p>"
  },
  {
    "id": "zitat",
    "heading": "Stimmen",
    "level": 2,
    "html": "<p>„Alles sauber", sagt eine Kundin, „und pünktlich".</p>
<p>Zweiter Absatz mit rohem Zeilenumbruch davor.</p>"
  }
]`;

function testRepairAndParse() {
  assert.throws(() => JSON.parse(STRINGIFIED_BLOCKS), "the raw string really is invalid JSON");
  const parsed = parseJsonLenient(STRINGIFIED_BLOCKS) as Array<{ id: string; html: string }>;
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(parsed.map((b) => b.id), ["h1", "fragen", "zitat"]);
  assert.equal(parsed[1]!.html, '<p><strong>„Muss ich während der Sanierung ausziehen?"</strong><br>Nein. Wir arbeiten raumweise.</p>');
  assert.equal(parsed[2]!.html, '<p>„Alles sauber", sagt eine Kundin, „und pünktlich".</p>\n<p>Zweiter Absatz mit rohem Zeilenumbruch davor.</p>');

  // Valid JSON is parsed as is; escaped quotes stay intact; fences are dropped; garbage is undefined.
  assert.deepEqual(parseJsonLenient('[{"a":"x \\"y\\" z"}]'), [{ a: 'x "y" z' }]);
  assert.deepEqual(parseJsonLenient('```json\n{"a": [1, 2]}\n```'), { a: [1, 2] });
  assert.equal(parseJsonLenient("kein JSON"), undefined);
  assert.equal(parseJsonLenient('[{"a": "offen'), undefined);
  // Structure quotes are recognised as such.
  assert.equal(repairJsonText('{"a": "b", "c": ["d", "e"]}'), '{"a": "b", "c": ["d", "e"]}');
  console.log("repair and parse: ok");
}

function testReviveToolInput() {
  const input = { title: "Bad | Firma", meta_description: "Kurz.", blocks: STRINGIFIED_BLOCKS };
  const revived = reviveStringifiedToolInput(input, TEXT_TOOL_SCHEMA as never) as typeof input & { blocks: unknown };
  assert.ok(Array.isArray(revived.blocks));
  assert.equal(revived.title, "Bad | Firma", "string properties stay strings");
  assert.equal(input.blocks, STRINGIFIED_BLOCKS, "the original object is not mutated");

  // A real array passes through untouched (same object); an unparseable string stays a string.
  const fine = { title: "", meta_description: "", blocks: [] };
  assert.equal(reviveStringifiedToolInput(fine, TEXT_TOOL_SCHEMA as never), fine);
  const broken = reviveStringifiedToolInput({ blocks: "nicht lesbar" }, TEXT_TOOL_SCHEMA as never) as { blocks: unknown };
  assert.equal(broken.blocks, "nicht lesbar");
  // Only properties declared as array/object are touched.
  const schema = { properties: { note: { type: "string" }, findings: { type: "array" } } };
  assert.deepEqual(reviveStringifiedToolInput({ note: "[1]", findings: "[1]" }, schema), { note: "[1]", findings: [1] });
  assert.equal(reviveStringifiedToolInput(null, schema), null);
  console.log("revive tool input: ok");
}

function testBlocksEndToEnd() {
  // The normaliser itself also accepts the string (second safety net).
  assert.deepEqual(normalizeBlocks(STRINGIFIED_BLOCKS).map((b) => b.id), ["h1", "fragen", "zitat"]);
  const out = normalizeSeoToolOutput({ title: "Bad", meta_description: "", blocks: STRINGIFIED_BLOCKS });
  assert.deepEqual(out.blocks.map((b) => [b.id, b.level]), [["h1", 1], ["hero", 2], ["fragen", 2], ["zitat", 2]]);
  assert.match(out.blocks[2]!.html, /ausziehen\?"<\/strong>/);
  console.log("blocks end to end: ok");
}

testRepairAndParse();
testReviveToolInput();
testBlocksEndToEnd();
console.log("ok: tolerant tool input");
