/**
 * Uploaded conversation / meeting files for Fragebogen prefills.
 * Run: npx tsx scripts/test-source-documents.ts
 */
import assert from "node:assert/strict";

import {
  formatSourceDocuments,
  normalizeSourceDocuments,
} from "../lib/surveys/source-documents";

const docs = normalizeSourceDocuments([
  { name: "Protokoll.docx", text: "Team: Anna Müller (Inhaberin), Max Schmidt (Beratung). Leistungen: SEO und Website." },
  { name: "  ", text: "zu kurz" },
  { name: "leer.txt", text: "   " },
  { name: "Notizen.md", text: "Firmensitz in Dortmund. USP: praxisnahe Workshops statt Blackbox." },
]);

assert.equal(docs.length, 2);
assert.equal(docs[0]?.name, "Protokoll.docx");
assert.match(docs[0]?.text ?? "", /Anna Müller/);
assert.equal(docs[1]?.name, "Notizen.md");

const formatted = formatSourceDocuments(docs);
assert.match(formatted, /Datei 1: Protokoll.docx/);
assert.match(formatted, /Datei 2: Notizen.md/);
assert.match(formatted, /Dortmund/);

const none = normalizeSourceDocuments([]);
assert.equal(none.length, 0);
assert.equal(formatSourceDocuments(none), "");

console.log("source-documents: ok");
