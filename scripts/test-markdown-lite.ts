/**
 * The small Markdown reader behind the twin's PDFs and HTML files.
 *
 *   npx tsx scripts/test-markdown-lite.ts
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

import { createPdfFromText, htmlishToMarkdown } from "../lib/dt/chat-file-pdf";
import { buildCreatedChatFile } from "../lib/dt/chat-files";

import { looksLikeMarkdown, markdownToHtml, parseInline, parseMarkdown } from "../lib/shared/markdown-lite";

function testInline() {
  assert.deepEqual(parseInline("Das ist **wichtig** und *kursiv* und `Code`."), [
    { text: "Das ist " },
    { text: "wichtig", bold: true },
    { text: " und " },
    { text: "kursiv", italic: true },
    { text: " und " },
    { text: "Code", code: true },
    { text: "." },
  ].map((s) => ({ ...s })));
  assert.deepEqual(parseInline("Siehe [Seite](https://example.org/a)."), [{ text: "Siehe " }, { text: "Seite", href: "https://example.org/a" }, { text: "." }]);
  assert.deepEqual(parseInline("5 * 3 = 15 und snake_case_name"), [{ text: "5 * 3 = 15 und snake_case_name" }], "stray stars and underscores stay text");
  assert.deepEqual(parseInline("**fett *und kursiv***").map((s) => [s.text, !!s.bold, !!s.italic]), [["fett ", true, false], ["und kursiv", true, true]]);
  console.log("inline: bold, italic, code, links, stray marks: ok");
}

const MD = `# Angebot für Praxis Weber

Ein **kurzer** Überblick.

## Leistungen

- Erstgespräch
- Behandlung
  - Dauer: 60 Minuten
- Nachsorge

1. Termin
2. Gespräch

| Leistung | Preis |
|---|---|
| Erstgespräch | 80 € |
| Folgetermin | 60 € |

> Hinweis: Preise inkl. MwSt.

---

\`\`\`
## kein Titel
\`\`\`
`;

function testBlocks() {
  const blocks = parseMarkdown(MD);
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "heading", "list", "list", "table", "quote", "rule", "code"]);
  assert.equal(blocks[0]!.type === "heading" && blocks[0]!.level, 1);
  const list = blocks[3]!;
  assert.ok(list.type === "list" && !list.ordered && list.items.map((i) => i.depth).join() === "0,0,1,0", "nesting by indentation");
  const numbered = blocks[4]!;
  assert.ok(numbered.type === "list" && numbered.ordered && numbered.items.map((i) => i.number).join() === "1,2");
  const table = blocks[5]!;
  assert.ok(table.type === "table" && table.header.length === 2 && table.rows.length === 2 && table.rows[1]![1]![0]!.text === "60 €");
  const code = blocks[8]!;
  assert.ok(code.type === "code" && code.text === "## kein Titel", "a code block keeps its text, marks included");
  console.log("blocks: headings, lists (nested, numbered), table, quote, rule, code: ok");
}

function testHtml() {
  const html = markdownToHtml(MD);
  assert.match(html, /^<h1>Angebot für Praxis Weber<\/h1>\n<p>Ein <strong>kurzer<\/strong> Überblick\.<\/p>\n<h2>Leistungen<\/h2>/);
  assert.match(html, /<ul><li>Erstgespräch<\/li><li>Behandlung<ul><li>Dauer: 60 Minuten<\/li><\/ul><\/li><li>Nachsorge<\/li><\/ul>/, "nested list inside its item");
  assert.match(html, /<ol><li>Termin<\/li><li>Gespräch<\/li><\/ol>/);
  assert.match(html, /<th style="border:1px solid #bbb;text-align:left">Leistung<\/th>/);
  assert.match(html, /<td style="border:1px solid #bbb">80 €<\/td>/);
  assert.doesNotMatch(html, /<h\d>\s*#/, "no Markdown marks in the headings (only the code block shows its own text)");
  // HTML in the input is escaped, scripts never run; unsafe links lose their target.
  const hostile = markdownToHtml('Text <script>alert(1)</script> [x](javascript:alert(1)) **<b>**');
  assert.ok(!/<script|href="javascript/i.test(hostile), hostile);
  assert.match(hostile, /&lt;script&gt;/);
  console.log("html: structure, nested lists, tables, escaping: ok");
}

function testDetect() {
  assert.ok(looksLikeMarkdown("## Titel\nText"));
  assert.ok(looksLikeMarkdown("- eins\n- zwei"));
  assert.ok(looksLikeMarkdown("Das ist **fett**."));
  assert.ok(!looksLikeMarkdown("Ein ganz normaler Satz ohne Auszeichnung. Auch mit Komma, und Punkt."));
  console.log("detect: Markdown or plain prose: ok");
}

async function testFiles() {
  // An html file written as Markdown becomes real HTML; real HTML stays as it is.
  const html = await buildCreatedChatFile({ fileName: "angebot.html", format: "html", content: "# Angebot\n\n## Leistungen\n\n- Erstgespräch\n- **Behandlung**", title: "Angebot" });
  assert.ok(html.ok);
  if (html.ok) {
    const text = new TextDecoder().decode(html.file.bytes);
    assert.match(text, /<h1>Angebot<\/h1>/);
    assert.match(text, /<h2>Leistungen<\/h2>/);
    assert.match(text, /<ul><li>Erstgespräch<\/li><li><strong>Behandlung<\/strong><\/li><\/ul>/);
    assert.doesNotMatch(text, /<h\d>\s*#|\*\*/, "no Markdown marks in the file");
  }
  const raw = await buildCreatedChatFile({ fileName: "x.html", format: "html", content: "<h2>Schon HTML</h2><p>## bleibt, wie geschrieben</p>" });
  assert.ok(raw.ok && new TextDecoder().decode(raw.file.bytes).includes("<h2>Schon HTML</h2><p>## bleibt, wie geschrieben</p>"));
  // HTML → Markdown for the PDF.
  assert.equal(htmlishToMarkdown("<h1>Titel</h1><p>Ein <strong>fetter</strong> und <em>kursiver</em> Satz.</p><ul><li>eins</li><li>zwei</li></ul>"), "# Titel\n\nEin **fetter** und *kursiver* Satz.\n\n- eins\n- zwei");
  console.log("files: Markdown html, html to Markdown: ok");

  // The PDF: several pages for a long text, and (where pdftotext exists) no Markdown marks in it.
  const long = Array.from({ length: 60 }, (_, i) => `## Abschnitt ${i + 1}\n\nDas ist **Absatz ${i + 1}** mit etwas Text, damit die Seite sich füllt und umbricht.\n\n- Punkt A\n- Punkt B`).join("\n\n");
  const bytes = await createPdfFromText({ text: long, title: "Langes Dokument" });
  assert.equal(new TextDecoder("latin1").decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3, "a long text runs over several pages");
  const dir = mkdtempSync(join(tmpdir(), "dt-pdf-"));
  try {
    const file = join(dir, "a.pdf");
    writeFileSync(file, await createPdfFromText({ text: "# Angebot für Praxis Weber\n\nEin **kurzer** Überblick.\n\n## Leistungen\n\n- Erstgespräch\n- Behandlung\n\n| Leistung | Preis |\n|---|---|\n| Erstgespräch | 80 € |", title: "Angebot" }));
    if (spawnSync("pdftotext", ["-v"]).error) {
      console.log("pdf: pdftotext not installed, text check skipped");
    } else {
      const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
      assert.match(text, /Angebot für Praxis Weber/);
      assert.match(text, /• Erstgespräch/);
      assert.match(text, /80 €/);
      assert.doesNotMatch(text, /##|\*\*|\|---/, `no Markdown marks in the PDF: ${text}`);
      console.log("pdf: headings, bullets, table, euro sign, no Markdown marks: ok");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

testInline();
testBlocks();
testHtml();
testDetect();
void testFiles()
  .then(() => console.log("OK: markdown-lite tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
