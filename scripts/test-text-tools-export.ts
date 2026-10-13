/**
 * Textwerkzeuge: TextOutput/blocks → HTML, fragment, Markdown and plain text downloads.
 * Run: npx tsx scripts/test-text-tools-export.ts
 */
import assert from "node:assert/strict";

import type { TextOutput } from "../lib/dt/content/pipeline/prompts";
import { fullHtmlDocument, htmlToMarkdown, htmlToPlainText, renderBlocksHtml } from "../lib/dt/content/render";
import { ingestMarkdown, ingestPlainText } from "../lib/dt/text-tools/ingest";
import {
  buildTextToolsExport,
  renderTextToolsFragment,
  renderTextToolsHtml,
  renderTextToolsMarkdown,
  renderTextToolsPlainText,
  TEXT_TOOLS_EXPORT_FORMATS,
  textToolsAttachmentHeader,
  textToolsDocument,
  textToolsDocumentFromBlocks,
  textToolsDocumentTitle,
  textToolsEditableBlocks,
  textToolsExportFilename,
  textToolsExportResponse,
  textToolsWordCount,
  isTextToolsExportFormat,
} from "../lib/dt/text-tools/export";

const output: TextOutput = {
  title: "Umzug Köln – Muster GmbH",
  meta_description: 'Umzüge in Köln ab 490 Euro, "fair" & schnell.',
  blocks: [
    { id: "umzug-in-koeln", heading: "Umzug in Köln", level: 1, html: "<p>Wir packen <strong>alles</strong> ein.</p>" },
    {
      id: "was-kostet-ein-umzug",
      heading: "Was kostet ein Umzug?",
      level: 2,
      html: '<ul><li>Ab 490 Euro</li><li><a href="https://example.de/preise">Preise</a></li></ul>',
    },
  ],
};

function testDocument() {
  const doc = textToolsDocument(output);
  assert.equal(doc.title, output.title);
  assert.equal(doc.metaDescription, output.meta_description);
  assert.equal(doc.blocks, output.blocks);
  assert.equal(textToolsDocument(doc), doc);
  assert.equal(textToolsDocumentTitle(doc), "Umzug Köln – Muster GmbH");
  assert.equal(textToolsDocumentTitle({ title: null, metaDescription: null, blocks: output.blocks }), "Umzug in Köln");
  assert.equal(textToolsDocumentTitle({ title: "  ", metaDescription: null, blocks: [] }), "Text");
  const fromBlocks = textToolsDocumentFromBlocks(output.blocks);
  assert.deepEqual([fromBlocks.title, fromBlocks.metaDescription], [null, null]);
  console.log("document: ok");
}

function testHtml() {
  const doc = textToolsDocument(output);
  const fragment = renderTextToolsFragment(doc);
  assert.equal(fragment, renderBlocksHtml(output.blocks));
  assert.match(fragment, /^<section data-block-id="umzug-in-koeln"><h1>Umzug in Köln<\/h1>/);

  const html = renderTextToolsHtml(doc);
  assert.equal(html, fullHtmlDocument(output.title!, fragment, { description: output.meta_description }));
  assert.match(html, /<title>Umzug Köln – Muster GmbH<\/title>/);
  assert.match(html, /<meta name="description" content="Umzüge in Köln ab 490 Euro, &quot;fair&quot; &amp; schnell\.">/);
  assert.ok(html.endsWith("</html>\n"));

  // Without a meta description the head carries none; the title falls back to the H1.
  const bare = renderTextToolsHtml({ title: null, metaDescription: null, blocks: output.blocks });
  assert.doesNotMatch(bare, /name="description"/);
  assert.match(bare, /<title>Umzug in Köln<\/title>/);
  // The existing Texte export keeps its two-argument form.
  assert.doesNotMatch(fullHtmlDocument("T", "<p>x</p>"), /name="description"/);
  console.log("html: ok");
}

function testPlainText() {
  const doc = textToolsDocument(output);
  const txt = renderTextToolsPlainText(doc);
  assert.equal(txt, htmlToPlainText(renderBlocksHtml(output.blocks)));
  assert.equal(txt, "Umzug in Köln\n\nWir packen alles ein.\n\nWas kostet ein Umzug?\n\n- Ab 490 Euro\n- Preise (https://example.de/preise)\n");

  const withMeta = renderTextToolsPlainText(doc, { includeMeta: true });
  assert.ok(withMeta.startsWith('Titel: Umzug Köln – Muster GmbH\nMeta-Description: Umzüge in Köln ab 490 Euro, "fair" & schnell.\n\nUmzug in Köln\n'));
  assert.equal(renderTextToolsPlainText({ ...doc, title: null, metaDescription: null }, { includeMeta: true }), txt);

  // The hint lines are what ingest reads back, so a .txt round trip keeps title and meta.
  const back = ingestPlainText(withMeta);
  assert.equal(back.hints.title, output.title);
  assert.equal(back.hints.metaDescription, output.meta_description);
  assert.deepEqual(back.blocks.map((b) => b.heading), ["Umzug in Köln", "Was kostet ein Umzug?"]);
  console.log("plain text: ok");
}

function testMarkdown() {
  const doc = textToolsDocument(output);
  const md = renderTextToolsMarkdown(doc);
  assert.equal(md, `${htmlToMarkdown(renderBlocksHtml(output.blocks))}\n`);
  assert.match(md, /^# Umzug in Köln\n\nWir packen \*\*alles\*\* ein\.\n\n## Was kostet ein Umzug\?\n\n- Ab 490 Euro\n- \[Preise\]\(https:\/\/example\.de\/preise\)\n$/);

  const withMeta = renderTextToolsMarkdown(doc, { includeMeta: true });
  assert.ok(withMeta.startsWith('---\ntitle: "Umzug Köln – Muster GmbH"\ndescription: "Umzüge in Köln ab 490 Euro, \\"fair\\" & schnell."\n---\n\n# Umzug in Köln\n'));

  // Front matter round trip through the Markdown ingest.
  const back = ingestMarkdown(withMeta);
  assert.equal(back.hints.title, output.title);
  assert.equal(back.hints.metaDescription, output.meta_description);
  assert.deepEqual(
    back.blocks.map((b) => [b.id, b.heading, b.level, b.html]),
    [
      ["umzug-in-koeln", "Umzug in Köln", 1, "<p>Wir packen <strong>alles</strong> ein.</p>"],
      ["was-kostet-ein-umzug", "Was kostet ein Umzug?", 2, '<ul><li>Ab 490 Euro</li><li><a href="https://example.de/preise">Preise</a></li></ul>'],
    ],
  );
  console.log("markdown: ok");
}

function testFilesAndResponse() {
  assert.deepEqual(TEXT_TOOLS_EXPORT_FORMATS, ["html", "fragment", "md", "txt"]);
  assert.equal(isTextToolsExportFormat("txt"), true);
  assert.equal(isTextToolsExportFormat("pdf"), false);

  assert.equal(textToolsExportFilename("html", "Umzug Köln – Muster GmbH"), "umzug-koeln-muster-gmbh.html");
  assert.equal(textToolsExportFilename("fragment", null, textToolsDocument(output)), "umzug-koeln-muster-gmbh.fragment.html");
  assert.equal(textToolsExportFilename("txt", "   "), "text.txt");
  assert.equal(textToolsExportFilename("md", "../../etc/passwd"), "etc-passwd.md");
  assert.equal(textToolsAttachmentHeader("a b/ü.txt"), 'attachment; filename="a_b__.txt"');

  const html = buildTextToolsExport(output, "html");
  assert.deepEqual([html.filename, html.contentType], ["umzug-koeln-muster-gmbh.html", "text/html; charset=utf-8"]);
  assert.equal(html.body, renderTextToolsHtml(textToolsDocument(output)));

  const txt = buildTextToolsExport(output, "txt", { baseName: "SEO-Text", includeMeta: true });
  assert.deepEqual([txt.filename, txt.contentType], ["seo-text.txt", "text/plain; charset=utf-8"]);
  assert.ok(txt.body.startsWith("Titel: "));

  const md = buildTextToolsExport(output, "md");
  assert.deepEqual([md.filename, md.contentType], ["umzug-koeln-muster-gmbh.md", "text/markdown; charset=utf-8"]);
  assert.ok(md.body.startsWith("# Umzug in Köln"));

  const fragment = buildTextToolsExport(output, "fragment");
  assert.equal(fragment.body, renderBlocksHtml(output.blocks));

  const response = textToolsExportResponse(txt);
  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="seo-text.txt"');
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  console.log("files and response: ok");
}

async function testResponseBody() {
  const response = textToolsExportResponse(buildTextToolsExport(output, "txt"));
  assert.equal(await response.text(), renderTextToolsPlainText(textToolsDocument(output)));
  console.log("response body: ok");
}

function testUiHelpers() {
  const doc = textToolsDocument(output);
  assert.deepEqual(textToolsEditableBlocks(doc), [
    { id: "umzug-in-koeln", text: "Umzug in Köln\n\nWir packen alles ein." },
    { id: "was-kostet-ein-umzug", text: "Was kostet ein Umzug?\n\nAb 490 Euro\nPreise" },
  ]);
  assert.equal(textToolsWordCount(output.blocks), 15);
  assert.equal(textToolsWordCount([]), 0);
  console.log("ui helpers: ok");
}

async function main() {
  testDocument();
  testHtml();
  testPlainText();
  testMarkdown();
  testFilesAndResponse();
  await testResponseBody();
  testUiHelpers();
  console.log("text-tools export: all ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
