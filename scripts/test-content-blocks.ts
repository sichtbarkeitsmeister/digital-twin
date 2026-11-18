/**
 * Own Abschnitte in the page window: insert one with its own heading, delete one.
 *
 *   npx tsx scripts/test-content-blocks.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addContentBlock, deleteContentBlock } from "../lib/dt/content/pipeline/actions";
import { CONTENT_MAX_BLOCKS, insertBlockAfter, parseBlocksFromHtml, plainTextToBlockHtml, removeBlock, renderBlocksHtml } from "../lib/dt/content/render";
import type { ContentPageRow } from "../lib/dt/content/store";

const HTML = [
  '<section data-block-id="hero"><h1>Heilpraktiker in Köln</h1>\n<p>Ihre Praxis.</p></section>',
  '<section data-block-id="ablauf"><h2>Ablauf</h2>\n<p>Erst das Gespräch.</p></section>',
  '<section data-block-id="stand"><p>Zuletzt aktualisiert: [DATUM]</p></section>',
].join("\n");

function testPlainText() {
  assert.equal(plainTextToBlockHtml("Erster Absatz.\n\nZweiter Absatz\nmit Umbruch."), "<p>Erster Absatz.</p>\n<p>Zweiter Absatz<br>mit Umbruch.</p>");
  assert.equal(plainTextToBlockHtml("Das brauchen Sie:\n- Ausweis\n- Versichertenkarte\n\nDanach:\n1. Termin\n2) Gespräch"), "<p>Das brauchen Sie:</p>\n<ul><li>Ausweis</li><li>Versichertenkarte</li></ul>\n<p>Danach:</p>\n<ol><li>Termin</li><li>Gespräch</li></ol>");
  assert.equal(plainTextToBlockHtml("5 < 6 & \"zitiert\""), "<p>5 &lt; 6 &amp; &quot;zitiert&quot;</p>", "typed text is escaped, never HTML");
  assert.equal(plainTextToBlockHtml("   \n\n  "), "");
  console.log("plain text: paragraphs, lists, escaping: ok");
}

function testInsert() {
  const out = insertBlockAfter(HTML, "hero", { heading: "  Was kostet   die Erstberatung?  ", level: 3, text: "Die Erstberatung kostet 80 €.\n\n- Dauer: 60 Minuten" });
  assert.ok(!("error" in out));
  if ("error" in out) return;
  const blocks = parseBlocksFromHtml(out.html);
  assert.deepEqual(blocks.map((b) => b.id), ["hero", "was-kostet-die-erstberatung", "ablauf", "stand"], "after the chosen one, id from the heading");
  assert.equal(blocks[1]!.heading, "Was kostet die Erstberatung?");
  assert.equal(blocks[1]!.level, 3);
  assert.equal(blocks[1]!.html, "<p>Die Erstberatung kostet 80 €.</p>\n<ul><li>Dauer: 60 Minuten</li></ul>");
  // The same heading again: a unique id.
  const again = insertBlockAfter(out.html, "ablauf", { heading: "Ablauf", level: 2, text: "Noch ein Absatz." });
  assert.ok(!("error" in again) && parseBlocksFromHtml(again.html).map((b) => b.id).includes("ablauf-2"), "no id twice");
  // A level other than H2–H4 becomes H2; errors.
  assert.equal((insertBlockAfter(HTML, "hero", { heading: "X", level: 1 as never, text: "y" }) as { block: { level: number } }).block.level, 2, "never a second H1");
  assert.deepEqual(insertBlockAfter(HTML, "hero", { heading: "  ", level: 2, text: "y" }), { error: "heading" });
  assert.deepEqual(insertBlockAfter(HTML, "hero", { heading: "X", level: 2, text: " \n " }), { error: "body" });
  assert.deepEqual(insertBlockAfter(HTML, "weg", { heading: "X", level: 2, text: "y" }), { error: "missing" });
  assert.deepEqual(insertBlockAfter(HTML, "hero", { heading: "X", level: 2, text: "x".repeat(31_000) }), { error: "size" });
  const many = renderBlocksHtml(Array.from({ length: CONTENT_MAX_BLOCKS }, (_, i) => ({ id: `b${i}`, heading: null, level: 2 as const, html: "<p>x</p>" })));
  assert.deepEqual(insertBlockAfter(many, "b0", { heading: "X", level: 2, text: "y" }), { error: "limit" });
  console.log("insert: position, id, level, errors: ok");
}

function testRemove() {
  const out = removeBlock(HTML, "ablauf");
  assert.ok(!("error" in out));
  if (!("error" in out)) assert.deepEqual(parseBlocksFromHtml(out.html).map((b) => b.id), ["hero", "stand"]);
  assert.deepEqual(removeBlock(HTML, "hero"), { error: "h1" }, "the H1 stays");
  assert.deepEqual(removeBlock(HTML, "weg"), { error: "missing" });
  assert.deepEqual(removeBlock('<section data-block-id="a"><h2>A</h2><p>x</p></section>', "a"), { error: "last" }, "the last Abschnitt stays");
  console.log("remove: any but the H1 and the last: ok");
}

type Update = { patch: Record<string, unknown>; filters: string[] };
function service(updates: Update[], error: { message: string } | null = null): SupabaseClient {
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const record: Update = { patch, filters: [] };
        updates.push(record);
        const chain: Record<string, unknown> = {
          eq: (c: string, v: unknown) => (record.filters.push(`eq ${c} ${String(v)}`), chain),
          neq: (c: string, v: unknown) => (record.filters.push(`neq ${c} ${String(v)}`), chain),
          then: (resolve: (v: unknown) => void) => resolve({ error }),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
}
const page = (extra: Partial<ContentPageRow> = {}): ContentPageRow =>
  ({ id: "p1", state: "braucht_sie", released: false, html: HTML, findings: [{ title: "a", block_id: "ablauf" }, { title: "b", block_id: "hero" }], final_findings: [], unresolved: [{ title: "c", block_id: "ablauf" }], questions: [{ question: "q", block_id: "ablauf" }], ...extra }) as unknown as ContentPageRow;

async function testActions() {
  const updates: Update[] = [];
  const added = await addContentBlock(service(updates), page(), { afterBlockId: "ablauf", heading: "Kosten", level: 2, text: "Die Kosten besprechen wir vorab." });
  assert.ok(added.ok && added.blockId === "kosten");
  assert.match((updates[0]!.patch as { html: string }).html, /data-block-id="kosten"><h2>Kosten<\/h2>/);
  assert.match((updates[0]!.patch as { markdown: string }).markdown, /Kosten/);
  assert.ok(updates[0]!.filters.includes("neq state laeuft"), "never writes into a page that started running meanwhile");

  const deletes: Update[] = [];
  assert.ok((await deleteContentBlock(service(deletes), page(), "ablauf")).ok);
  const patch = deletes[0]!.patch as { html: string; findings: Array<{ block_id: string }>; unresolved: unknown[]; questions: unknown[] };
  assert.ok(!patch.html.includes('data-block-id="ablauf"'));
  assert.deepEqual(patch.findings.map((f) => f.block_id), ["hero"], "open points of the deleted Abschnitt go with it");
  assert.equal(patch.unresolved.length + patch.questions.length, 0);
  const h1 = await deleteContentBlock(service([]), page(), "hero");
  assert.ok(!h1.ok && h1.status === 400 && /H1/.test(h1.message));

  for (const state of ["laeuft", "nicht_begonnen"] as const) {
    assert.ok(!(await addContentBlock(service([]), page({ state }), { afterBlockId: "hero", heading: "X", level: 2, text: "y" })).ok, `no insert while ${state}`);
    assert.ok(!(await deleteContentBlock(service([]), page({ state }), "ablauf")).ok, `no delete while ${state}`);
  }
  assert.ok(!(await deleteContentBlock(service([]), page({ state: "fertig", released: true }), "ablauf")).ok, "a released page keeps its Abschnitte");
  const noHeading = await addContentBlock(service([]), page(), { afterBlockId: "hero", heading: "", level: 2, text: "y" });
  assert.ok(!noHeading.ok && noHeading.status === 400 && /Überschrift/.test(noHeading.message));
  assert.ok(!(await addContentBlock(service([], { message: "db down" }), page(), { afterBlockId: "hero", heading: "X", level: 2, text: "y" })).ok);
  console.log("actions: insert and delete, states, open points go with the Abschnitt: ok");
}

async function main() {
  testPlainText();
  testInsert();
  testRemove();
  await testActions();
  console.log("OK: content blocks tests passed");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
