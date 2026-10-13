/**
 * Textwerkzeuge: uploads and pasted text → blocks and hints.
 * Run: npx tsx scripts/test-text-tools-ingest.ts
 */
import assert from "node:assert/strict";

import { createPdfFromText } from "../lib/dt/chat-file-pdf";
import { htmlToPlainText, renderBlocksHtml } from "../lib/dt/content/render";
import {
  detectTextToolsSourceKind,
  ingestHtml,
  ingestMarkdown,
  ingestPlainText,
  ingestTextToolsBytes,
  ingestTextToolsPaste,
  inlineMarkdownToHtml,
  looksLikePlainTextHeading,
  pdfTextToParagraphs,
  TEXT_TOOLS_MAX_BLOCKS,
  textToolsIngestToOutput,
} from "../lib/dt/text-tools/ingest";

const plain = (html: string) => htmlToPlainText(html).trim();

function testHtmlDocument() {
  const html = `<!DOCTYPE html><html lang="de"><head>
    <title>Umzug Köln | Muster GmbH</title>
    <meta name="description" content="Umzüge in Köln ab 490 Euro.">
    <style>h1 { color: red }</style></head>
    <body>
      <header><nav><a href="/">Start</a></nav></header>
      <main>
        <h1>Umzug in <em>Köln</em></h1>
        <p>Wir packen   <strong>alles</strong> ein.<br>Auch das Klavier.</p>
        <div><span>Lose Zeile</span> im <a href="https://example.de/x" class="btn" onclick="x()">Container</a>.</div>
        <h2>Was kostet ein Umzug?</h2>
        <ul><li>Ab 490 Euro</li><li>Klavier <b>extra</b></li></ul>
        <table><tr><th>Leistung</th><th>Preis</th></tr><tr><td>Umzug</td><td>490 €</td></tr></table>
        <h3>Scan oder Bild</h3>
        <img src="x.png" alt="Bild">
        <p>&nbsp;</p>
        <blockquote><p>Sehr zufrieden.</p></blockquote>
        <script>alert(1)</script>
        <pre>Zeile 1\nZeile 2</pre>
      </main>
      <footer><p>Impressum</p></footer>
    </body></html>`;
  const out = ingestHtml(html, { filename: "umzug.html" });
  assert.equal(out.kind, "html");
  assert.equal(out.filename, "umzug.html");
  assert.equal(out.hints.title, "Umzug Köln | Muster GmbH");
  assert.equal(out.hints.h1, "Umzug in Köln");
  assert.equal(out.hints.metaDescription, "Umzüge in Köln ab 490 Euro.");

  assert.deepEqual(
    out.blocks.map((b) => [b.id, b.heading, b.level]),
    [
      ["umzug-in-koeln", "Umzug in Köln", 1],
      ["was-kostet-ein-umzug", "Was kostet ein Umzug?", 2],
      ["scan-oder-bild", "Scan oder Bild", 3],
    ],
  );
  const [h1, h2, h3] = out.blocks;
  assert.equal(h1!.html, '<p>Wir packen <strong>alles</strong> ein.<br>Auch das Klavier.</p>\n<p>Lose Zeile im <a href="https://example.de/x">Container</a>.</p>');
  assert.match(h2!.html, /^<ul><li>Ab 490 Euro<\/li><li>Klavier <b>extra<\/b><\/li><\/ul>\n<p>Leistung \| Preis<\/p>\n<p>Umzug \| 490 €<\/p>$/);
  assert.equal(h3!.html, "<blockquote><p>Sehr zufrieden.</p></blockquote>\n<p>Zeile 1<br>Zeile 2</p>");
  const rendered = renderBlocksHtml(out.blocks);
  assert.doesNotMatch(rendered, /Impressum|Start|alert|onclick|class=/);
  assert.equal(out.warnings.length, 0);

  const output = textToolsIngestToOutput(out);
  assert.equal(output.title, "Umzug Köln | Muster GmbH");
  assert.equal(output.meta_description, "Umzüge in Köln ab 490 Euro.");
  assert.equal(output.blocks, out.blocks);
  console.log("html document: ok");
}

function testHtmlFragmentAndEdgeCases() {
  const fragment = ingestHtml("<p>Nur ein Absatz.</p><h2>Später</h2><p>Mehr.</p>");
  assert.deepEqual(
    fragment.blocks.map((b) => [b.id, b.heading, b.level, b.html]),
    [
      ["abschnitt-1", null, 2, "<p>Nur ein Absatz.</p>"],
      ["spaeter", "Später", 2, "<p>Mehr.</p>"],
    ],
  );
  assert.equal(fragment.hints.title, "Später");
  assert.equal(fragment.hints.h1, null);

  // Two headings with the same text get distinct ids; an H1 after other blocks is level 2.
  const twice = ingestHtml("<p>Intro</p><h1>FAQ</h1><p>a</p><h2>FAQ</h2><p>b</p>");
  assert.deepEqual(twice.blocks.map((b) => [b.id, b.level]), [["abschnitt-1", 2], ["faq", 2], ["faq-2", 2]]);
  assert.equal(twice.hints.h1, "FAQ");

  // Empty headings and empty paragraphs are dropped; nothing usable → no blocks.
  assert.deepEqual(ingestHtml("<h2>   </h2><p> </p><p>&nbsp;</p>").blocks, []);
  console.log("html fragment: ok");
}

function testMarkdown() {
  const md = `---
title: "Umzug Köln"
description: Günstig umziehen.
---

Umzug in Köln
=============

Wir packen **alles** ein, auch das *Klavier* und [mehr](https://example.de).

## Was kostet ein Umzug?

- Ab 490 Euro
- Klavier __extra__

1. Anfragen
2. Angebot
   erhalten

> Sehr zufrieden.
>
> Gerne wieder.

### Code

\`\`\`
const x = 1;
\`\`\`

---

Letzter Absatz
mit zwei Zeilen.
`;
  const out = ingestMarkdown(md, { filename: "umzug.md" });
  assert.equal(out.kind, "markdown");
  assert.equal(out.hints.title, "Umzug Köln");
  assert.equal(out.hints.metaDescription, "Günstig umziehen.");
  assert.equal(out.hints.h1, "Umzug in Köln");
  assert.deepEqual(
    out.blocks.map((b) => [b.heading, b.level]),
    [
      ["Umzug in Köln", 1],
      ["Was kostet ein Umzug?", 2],
      ["Code", 3],
    ],
  );
  const [a, b, c] = out.blocks;
  assert.equal(a!.html, '<p>Wir packen <strong>alles</strong> ein, auch das <em>Klavier</em> und <a href="https://example.de">mehr</a>.</p>');
  assert.equal(
    b!.html,
    "<ul><li>Ab 490 Euro</li><li>Klavier <strong>extra</strong></li></ul>\n<ol><li>Anfragen</li><li>Angebot erhalten</li></ol>\n<blockquote><p>Sehr zufrieden.</p><p>Gerne wieder.</p></blockquote>",
  );
  assert.equal(c!.html, "<p>const x = 1;</p>\n<p>Letzter Absatz mit zwei Zeilen.</p>");
  assert.equal(out.warnings.length, 0);

  // Without front matter the title comes from the first H1; hint lines above the text count too.
  const hinted = ingestMarkdown("Titel: Mein Titel\nMeta-Description: Meine Beschreibung\n\n# Überschrift\n\nText.");
  assert.equal(hinted.hints.title, "Mein Titel");
  assert.equal(hinted.hints.metaDescription, "Meine Beschreibung");
  assert.deepEqual(hinted.blocks.map((b) => [b.heading, b.html]), [["Überschrift", "<p>Text.</p>"]]);

  // Markdown is not HTML: angle brackets stay text.
  assert.equal(inlineMarkdownToHtml("a <b> & *x*"), "a &lt;b&gt; &amp; <em>x</em>");
  assert.equal(inlineMarkdownToHtml("snake_case_name"), "snake_case_name");
  console.log("markdown: ok");
}

function testPlainText() {
  const text = `Titel: Umzug Köln

Umzug in Köln

Wir packen alles ein.
Auch das Klavier.

Was kostet ein Umzug?

Ab 490 Euro. Klavier extra.

Rufen Sie an!
`;
  const out = ingestPlainText(text, { filename: "umzug.txt" });
  assert.equal(out.kind, "text");
  assert.equal(out.hints.title, "Umzug Köln");
  assert.deepEqual(
    out.blocks.map((b) => [b.heading, b.level, b.html]),
    [
      ["Umzug in Köln", 1, "<p>Wir packen alles ein.<br>Auch das Klavier.</p>"],
      ["Was kostet ein Umzug?", 2, "<p>Ab 490 Euro. Klavier extra.</p>\n<p>Rufen Sie an!</p>"],
    ],
  );
  assert.ok(out.warnings.some((w) => /geschätzt/.test(w)));

  assert.equal(looksLikePlainTextHeading("Was kostet ein Umzug?"), true);
  assert.equal(looksLikePlainTextHeading("Rufen Sie an!"), false);
  assert.equal(looksLikePlainTextHeading("Das ist ein Satz."), false);
  assert.equal(looksLikePlainTextHeading("- Listenpunkt"), false);
  assert.equal(looksLikePlainTextHeading("2024"), false);
  assert.equal(looksLikePlainTextHeading("x".repeat(91)), false);

  // A short last line is text, not a heading; a text without headings is one block.
  const single = ingestPlainText("Nur ein Satz.\n\nUnd noch einer.\n\nEnde");
  assert.deepEqual(single.blocks.map((b) => [b.heading, b.html]), [[null, "<p>Nur ein Satz.</p>\n<p>Und noch einer.</p>\n<p>Ende</p>"]]);
  assert.equal(single.hints.title, null);
  console.log("plain text: ok");
}

function testPasteDetection() {
  assert.equal(ingestTextToolsPaste("<h1>Hallo</h1><p>Welt</p>").kind, "html");
  assert.equal(ingestTextToolsPaste("# Hallo\n\nWelt").kind, "markdown");
  assert.equal(ingestTextToolsPaste("Hallo\n\nWelt ist **fett**").kind, "markdown");
  assert.equal(ingestTextToolsPaste("Hallo\n\nWelt.").kind, "text");
  assert.equal(ingestTextToolsPaste("3 < 5 und 7 > 2").kind, "text");
  console.log("paste detection: ok");
}

function testLimits() {
  const sentence = "Dieser Satz ist absichtlich lang genug, um einen Block zu füllen. ";
  const huge = `<h2>Lang</h2><p>${sentence.repeat(400)}</p>`;
  const out = ingestHtml(huge);
  assert.ok(out.blocks.length >= 3, `expected the paragraph split into blocks, got ${out.blocks.length}`);
  assert.deepEqual(out.blocks.map((b) => b.heading), ["Lang", ...out.blocks.slice(1).map(() => null)]);
  for (const block of out.blocks) {
    assert.ok(block.html.length <= 12_000);
    assert.match(block.html, /^<p>[\s\S]*<\/p>$/);
  }
  const joined = plain(renderBlocksHtml(out.blocks)).replace(/\s+/g, " ");
  assert.equal(joined.split("Dieser Satz").length - 1, 400, "no sentence lost in the split");

  const many = Array.from({ length: TEXT_TOOLS_MAX_BLOCKS + 5 }, (_, i) => `<h2>Teil ${i + 1}</h2><p>Text ${i + 1}</p>`).join("");
  const capped = ingestHtml(many);
  assert.equal(capped.blocks.length, TEXT_TOOLS_MAX_BLOCKS);
  assert.ok(capped.warnings.some((w) => w.includes(`${TEXT_TOOLS_MAX_BLOCKS}`)));
  console.log("limits: ok");
}

function testDetectKind() {
  assert.equal(detectTextToolsSourceKind("a.docx", ""), "docx");
  assert.equal(detectTextToolsSourceKind("a", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(detectTextToolsSourceKind("a.PDF", null), "pdf");
  assert.equal(detectTextToolsSourceKind("a.htm", "text/html; charset=utf-8"), "html");
  assert.equal(detectTextToolsSourceKind("a.md", "application/octet-stream"), "markdown");
  assert.equal(detectTextToolsSourceKind("a.txt", null), "text");
  assert.equal(detectTextToolsSourceKind("notes", ""), "text");
  assert.equal(detectTextToolsSourceKind("a.bin", "text/x-log"), "text");
  assert.equal(detectTextToolsSourceKind("a.xlsx", ""), null);
  assert.equal(detectTextToolsSourceKind("a.png", "image/png"), null);
  console.log("detect kind: ok");
}

async function testBytes() {
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("# Titel\n\nText mit Ümlaut.")]);
  const md = await ingestTextToolsBytes({ filename: "x.md", bytes: utf8Bom });
  assert.equal(md.kind, "markdown");
  assert.deepEqual(md.blocks.map((b) => [b.heading, b.html]), [["Titel", "<p>Text mit Ümlaut.</p>"]]);

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Überschrift\n\nAbsatz eins.", "utf16le")]);
  const txt = await ingestTextToolsBytes({ filename: "x.txt", mimeType: "text/plain", bytes: new Uint8Array(utf16) });
  assert.deepEqual(txt.blocks.map((b) => [b.heading, b.html]), [["Überschrift", "<p>Absatz eins.</p>"]]);

  const html = await ingestTextToolsBytes({ filename: "x.html", bytes: new Uint8Array(Buffer.from("<h1>H</h1><p>P</p>")) });
  assert.equal(html.kind, "html");

  await assert.rejects(ingestTextToolsBytes({ filename: "alt.doc", bytes: new Uint8Array([1]) }), /altes Word-Format/);
  await assert.rejects(ingestTextToolsBytes({ filename: "bild.png", mimeType: "image/png", bytes: new Uint8Array([1]) }), /wird nicht unterstützt/);
  await assert.rejects(ingestTextToolsBytes({ filename: "leer.txt", bytes: new Uint8Array() }), /ist leer/);
  await assert.rejects(ingestTextToolsBytes({ filename: "leer.html", bytes: new Uint8Array(Buffer.from("<p> </p>")) }), /keinen lesbaren Text/);
  await assert.rejects(ingestTextToolsBytes({ filename: "kaputt.docx", bytes: new Uint8Array(Buffer.from("nicht zip")) }), /konnte nicht gelesen werden/);
  await assert.rejects(ingestTextToolsBytes({ filename: "kaputt.pdf", bytes: new Uint8Array(Buffer.from("nicht pdf")) }), /konnte nicht gelesen werden/);
  console.log("bytes: ok");
}

function testPdfParagraphs() {
  // Rows of a PDF: a heading row at a sentence boundary stands alone, short closing rows end a paragraph.
  const rows = [
    "Umzug in Köln",
    "Wir packen alles ein, auch das Klavier und den Flügel aus dem",
    "vierten Stock. Dafür kommen wir mit einem Außenlift vorbei.",
    "Was kostet ein Umzug?",
    "Ab 490 Euro, Klavier extra. Fragen Sie nach einem Angebot für",
    "Ihren Termin.",
    "Rufen Sie an.",
  ].join("\n");
  assert.deepEqual(pdfTextToParagraphs(rows).split("\n\n"), [
    "Umzug in Köln",
    "Wir packen alles ein, auch das Klavier und den Flügel aus dem vierten Stock. Dafür kommen wir mit einem Außenlift vorbei.",
    "Was kostet ein Umzug?",
    "Ab 490 Euro, Klavier extra. Fragen Sie nach einem Angebot für Ihren Termin.",
    "Rufen Sie an.",
  ]);
  const out = ingestMarkdown(pdfTextToParagraphs(rows), { guessHeadings: true, softBreak: "space" });
  assert.deepEqual(out.blocks.map((b) => [b.heading, b.level]), [["Umzug in Köln", 1], ["Was kostet ein Umzug?", 2]]);
  assert.equal(pdfTextToParagraphs(""), "");
  console.log("pdf paragraphs: ok");
}

async function testPdf() {
  const bytes = await createPdfFromText({
    title: "Umzug in Köln",
    text: "Wir packen alles ein, auch das Klavier.\n\nWas kostet ein Umzug?\n\nAb 490 Euro, Klavier extra.",
  });
  const before = bytes.byteLength;
  const out = await ingestTextToolsBytes({ filename: "umzug.pdf", mimeType: "application/pdf", bytes });
  assert.equal(bytes.byteLength, before, "the caller's bytes stay intact");
  assert.equal(out.kind, "pdf");
  assert.deepEqual(
    out.blocks.map((b) => [b.heading, b.level, plain(b.html)]),
    [
      ["Umzug in Köln", 1, "Wir packen alles ein, auch das Klavier."],
      ["Was kostet ein Umzug?", 2, "Ab 490 Euro, Klavier extra."],
    ],
  );
  assert.equal(out.hints.title, "Umzug in Köln");
  assert.equal(out.hints.h1, "Umzug in Köln");
  assert.ok(out.warnings.some((w) => /PDF/.test(w)));
  console.log("pdf: ok");
}

// --- a minimal .docx (stored zip, no compression) for the Word path ---------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files: Array<[string, string]>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}

function minimalDocx(): Uint8Array {
  const p = (text: string, style?: string, bold = false) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${p("Umzug in Köln", "Heading1")}
${p("Wir packen alles ein.")}
${p("Was kostet ein Umzug?", "Heading2")}
<w:p><w:r><w:t xml:space="preserve">Ab </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>490 Euro</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
</w:body></w:document>`;
  return storedZip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ],
    ["word/document.xml", document],
  ]);
}

async function testDocx() {
  const out = await ingestTextToolsBytes({ filename: "umzug.docx", bytes: minimalDocx() });
  assert.equal(out.kind, "docx");
  assert.deepEqual(
    out.blocks.map((b) => [b.id, b.heading, b.level, b.html]),
    [
      ["umzug-in-koeln", "Umzug in Köln", 1, "<p>Wir packen alles ein.</p>"],
      ["was-kostet-ein-umzug", "Was kostet ein Umzug?", 2, "<p>Ab <strong>490 Euro</strong>.</p>"],
    ],
  );
  assert.equal(out.hints.title, "Umzug in Köln");
  assert.equal(out.hints.h1, "Umzug in Köln");
  assert.equal(out.hints.metaDescription, null);
  console.log("docx: ok");
}

async function main() {
  testHtmlDocument();
  testHtmlFragmentAndEdgeCases();
  testMarkdown();
  testPlainText();
  testPasteDetection();
  testLimits();
  testDetectKind();
  testPdfParagraphs();
  await testBytes();
  await testPdf();
  await testDocx();
  console.log("text-tools ingest: all ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
