/**
 * „Text direkt ändern“: the page window lets the person click into the text. What the server does
 * with an edited Abschnitt, and what the browser's editor leaves behind.
 *
 *   npx tsx scripts/test-content-text-edit.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { restoreKundePrueft } from "../components/dt/content/dt-content-text-frame";
import { contentExportFile } from "../lib/dt/content/export";
import { editContentBlockHtml, editContentMeta } from "../lib/dt/content/pipeline/actions";
import { parseBlocksFromHtml, replaceBlockContent } from "../lib/dt/content/render";
import type { ContentPageRow } from "../lib/dt/content/store";

const HTML = [
  '<section data-block-id="hero"><h1>Heilpraktiker in Köln</h1>\n<p>Ihre Praxis.</p></section>',
  '<section data-block-id="ablauf"><h2>Ablauf</h2>\n<p>Erst das Gespräch.</p>\n<ul><li>Termin</li><li>Behandlung</li></ul></section>',
  '<section data-block-id="stand"><p>Zuletzt aktualisiert: [DATUM]</p></section>',
].join("\n");

function testReplace() {
  const out = replaceBlockContent(HTML, "ablauf", { heading: "  Ablauf der   Behandlung ", bodyHtml: "<p>Erst das <strong>Gespräch</strong>.</p><ul><li>Termin</li></ul>" })!;
  const blocks = parseBlocksFromHtml(out.html);
  assert.equal(blocks.length, 3, "the other Abschnitte are untouched");
  assert.equal(blocks[1]!.heading, "Ablauf der Behandlung", "heading text replaced, spacing tidied");
  assert.equal(blocks[1]!.level, 2, "the level stays");
  assert.equal(blocks[1]!.html, "<p>Erst das <strong>Gespräch</strong>.</p><ul><li>Termin</li></ul>");
  assert.equal(blocks[0]!.html, "<p>Ihre Praxis.</p>");

  // Whatever the editor leaves behind is cleaned like model output.
  const dirty = replaceBlockContent(HTML, "ablauf", {
    heading: null,
    bodyHtml: '<p style="color:red" onclick="x()">Text <span style="font-size:99px">mit Span</span><script>alert(1)</script></p><div>Zeile</div><p><br></p><p>  </p><a href="javascript:alert(1)">Link</a><a href="https://example.org/a">gut</a>',
  })!;
  assert.equal(dirty.block.heading, "Ablauf", "no heading given: the old one stays");
  assert.ok(!/style=|onclick|<span|<div|<script|javascript:/i.test(dirty.block.html), `cleaned: ${dirty.block.html}`);
  assert.ok(/<a href="https:\/\/example\.org\/a">gut<\/a>/.test(dirty.block.html), "a safe link stays");
  assert.ok(!/<p>\s*<\/p>|<p><br><\/p>/.test(dirty.block.html), "empty paragraphs are dropped");

  // A heading can only be changed where there is one; the empty heading keeps the old one.
  const noHeading = replaceBlockContent(HTML, "stand", { heading: "Neu", bodyHtml: "<p>x</p>" })!;
  assert.equal(noHeading.block.heading, null, "an Abschnitt without a heading gets none");
  assert.equal(replaceBlockContent(HTML, "ablauf", { heading: "   ", bodyHtml: "<p>x</p>" })!.block.heading, "Ablauf");
  assert.equal(replaceBlockContent(HTML, "gibt-es-nicht", { bodyHtml: "<p>x</p>" }), null);
  console.log("replace: body and heading, cleaned, level and neighbours stay: ok");
}

function testRestore() {
  const shown = '<p>Der Preis: <strong class="kunde-prueft">[KUNDE PRÜFT: Was kostet die Erstberatung?]</strong> ab 80 €.</p>';
  assert.equal(restoreKundePrueft(shown), "<p>Der Preis: [BITTE PRÜFEN: Was kostet die Erstberatung?] ab 80 €.</p>", "the stored placeholder, not the display form");
  assert.equal(restoreKundePrueft("<p>Ohne Marker</p>"), "<p>Ohne Marker</p>");
  console.log("restore: the customer-check marker goes back to the stored placeholder: ok");
}

type Update = { patch: Record<string, unknown>; filters: string[] };

function service(updates: Update[], error: { message: string } | null = null): SupabaseClient {
  return {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const record: Update = { patch, filters: [] };
        updates.push(record);
        const chain: Record<string, unknown> = {
          eq: (col: string, v: unknown) => (record.filters.push(`eq ${col} ${String(v)}`), chain),
          neq: (col: string, v: unknown) => (record.filters.push(`neq ${col} ${String(v)}`), chain),
          then: (resolve: (v: unknown) => void) => resolve({ error }),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
}

function page(extra: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    id: "p1",
    state: "braucht_sie",
    released: false,
    html: HTML,
    findings: [{ title: "a", block_id: "ablauf" }, { title: "b", block_id: "hero" }],
    final_findings: [],
    unresolved: [{ title: "c", block_id: "ablauf" }],
    questions: [{ question: "q", block_id: "ablauf" }],
    ...extra,
  } as unknown as ContentPageRow;
}

async function testAction() {
  const updates: Update[] = [];
  const ok = await editContentBlockHtml(service(updates), page(), "ablauf", { heading: "Ablauf", bodyHtml: "<p>Neu geschrieben.</p>" });
  assert.deepEqual(ok, { ok: true, jobId: null });
  const patch = updates[0]!.patch as { html: string; markdown: string; findings: Array<{ block_id: string }>; unresolved: unknown[]; questions: unknown[] };
  assert.match(patch.html, /<p>Neu geschrieben\.<\/p>/);
  assert.match(patch.markdown, /Neu geschrieben/);
  assert.deepEqual(patch.findings.map((f) => f.block_id), ["hero"], "open points of the edited Abschnitt count as handled, the others stay");
  assert.equal(patch.unresolved.length, 0);
  assert.equal(patch.questions.length, 0);
  assert.ok(updates[0]!.filters.includes("neq state laeuft"), "never writes into a page that started running meanwhile");

  for (const state of ["laeuft", "nicht_begonnen"] as const) {
    const refused = await editContentBlockHtml(service([]), page({ state }), "ablauf", { bodyHtml: "<p>x</p>" });
    assert.ok(!refused.ok && refused.status === 409, `no editing while ${state}`);
  }
  const released = await editContentBlockHtml(service([]), page({ state: "fertig", released: true }), "ablauf", { bodyHtml: "<p>x</p>" });
  assert.ok(!released.ok && released.status === 409, "a released text is not changed");
  assert.ok((await editContentBlockHtml(service([]), page({ state: "fertig" }), "ablauf", { bodyHtml: "<p>x</p>" })).ok, "a finished, not yet released text can be");
  const empty = await editContentBlockHtml(service([]), page(), "ablauf", { bodyHtml: "<p><br></p>" });
  assert.ok(!empty.ok && empty.status === 400 && /nicht leer sein/.test(empty.message), "a stray delete does not empty an Abschnitt");
  const missing = await editContentBlockHtml(service([]), page(), "weg", { bodyHtml: "<p>x</p>" });
  assert.ok(!missing.ok && missing.status === 404);
  const huge = await editContentBlockHtml(service([]), page(), "ablauf", { bodyHtml: `<p>${"x".repeat(31_000)}</p>` });
  assert.ok(!huge.ok && huge.status === 400 && /zu lang/.test(huge.message));
  const failing = await editContentBlockHtml(service([], { message: "db down" }), page(), "ablauf", { bodyHtml: "<p>x</p>" });
  assert.ok(!failing.ok && failing.status === 500);
  console.log("action: states, handled points, empty/long/missing, no write into a running page: ok");
}

async function testMeta() {
  const updates: Update[] = [];
  const ok = await editContentMeta(service(updates), page(), { title: "  Heilpraktiker   Köln | Praxis Weber ", metaDescription: "Beschreibung\nin zwei Zeilen." });
  assert.deepEqual(ok, { ok: true, jobId: null });
  assert.deepEqual(updates[0]!.patch, { title: "Heilpraktiker Köln | Praxis Weber", meta_description: "Beschreibung in zwei Zeilen." }, "whitespace tidied");
  assert.ok(updates[0]!.filters.includes("neq state laeuft"), "never writes into a page that started running meanwhile");

  const only = [] as Update[];
  await editContentMeta(service(only), page(), { metaDescription: "Nur die Beschreibung." });
  assert.deepEqual(only[0]!.patch, { meta_description: "Nur die Beschreibung." }, "only the field sent changes");
  const cleared = [] as Update[];
  await editContentMeta(service(cleared), page(), { title: "   " });
  assert.deepEqual(cleared[0]!.patch, { title: null }, "an empty field is cleared");

  assert.ok(!(await editContentMeta(service([]), page(), {})).ok, "nothing to change");
  for (const state of ["laeuft", "nicht_begonnen"] as const) {
    const refused = await editContentMeta(service([]), page({ state }), { title: "x" });
    assert.ok(!refused.ok && refused.status === 409, `no editing while ${state}`);
  }
  assert.ok(!(await editContentMeta(service([]), page({ state: "fertig", released: true }), { title: "x" })).ok, "a released page keeps its meta");
  const long = await editContentMeta(service([]), page(), { metaDescription: "x".repeat(500) });
  assert.ok(!long.ok && long.status === 400);
  console.log("meta: only the given fields, tidied, cleared when empty, same states as the text: ok");
}

function testExport() {
  const source = { slug: "immun", title: "Immunsystem in Köln", metaDescription: 'Stärken Sie Ihr Immunsystem – "ohne" Heilversprechen & mit Plan.', html: HTML };
  const html = contentExportFile("html", source).body;
  assert.match(html, /<title>Immunsystem in Köln<\/title><meta name="description" content="Stärken Sie Ihr Immunsystem – &quot;ohne&quot; Heilversprechen &amp; mit Plan\.">/, "the full HTML carries the meta description, escaped");
  assert.doesNotMatch(contentExportFile("html", { slug: "x", title: "T", html: HTML }).body, /name="description"/, "none when the page has none (the standalone tools)");
  assert.doesNotMatch(contentExportFile("fragment", source).body, /Meta-Description|name="description"/, "the fragment is only the text");
  const txt = contentExportFile("txt", source, { levelLabels: true, metaHeader: true }).body;
  assert.ok(txt.startsWith("Title: Immunsystem in Köln\nMeta-Description: Stärken Sie Ihr Immunsystem"), "the .txt of the Texte page leads with both");
  assert.ok(contentExportFile("md", source, { metaHeader: true }).body.startsWith("Title: Immunsystem in Köln\nMeta-Description:"));
  assert.ok(!contentExportFile("txt", source, { levelLabels: true }).body.startsWith("Title:"), "the standalone tools export as before");
  console.log("export: meta description in the HTML, header in .txt/.md of the Texte page: ok");
}

async function main() {
  testReplace();
  testRestore();
  await testAction();
  await testMeta();
  testExport();
  console.log("OK: content text edit tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
