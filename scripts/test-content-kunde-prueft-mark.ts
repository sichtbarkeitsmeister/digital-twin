/**
 * Texte: „KUNDE PRÜFT“ on an open point. The placeholder the point is about is found in the text,
 * noted as with the customer, and shown as a bold „[KUNDE PRÜFT: …]“ in the window and the exports.
 * No network, no model. Run: npx tsx scripts/test-content-kunde-prueft-mark.ts
 */
import assert from "node:assert/strict";
import { findingCheckPlaceholders, kundePrueftNoteLine, kundePrueftQuestionsInNotes, markKundePrueftHtml } from "../lib/dt/content/pipeline/kunde-prueft";
import { answeredInNotes } from "../lib/dt/content/pipeline/questions";
import { htmlToMarkdown, htmlToPlainText } from "../lib/dt/content/render";
const Q = "Wie behandelt Daniel Sartor Uhren mit unvollständigen Papieren, zum Beispiel einem alten Kaufbeleg ohne Garantiekarte, und gilt ein solcher Beleg als Originalrechnung?";
const blocks = [{ id: "fragen-2", heading: "Fragen", html: `<p>Text &amp; mehr. [BITTE PRÜFEN: ${Q}]</p><p>[BITTE PRÜFEN: Andere Frage hier?]</p>` }, { id: "x", heading: null, html: "<p>nix</p>" }];
const f = { title: "Platzhalter BITTE PRÜFEN in fragen-2 offen", problem: `Im aktuellen Text steht in fragen-2: „[BITTE PRÜFEN: ${Q}]“. Kein gewollter Platzhalter.`, proposal: "Platzhalter entfernen" };
assert.deepEqual(findingCheckPlaceholders(f, blocks, ["fragen-2"]), [Q]);
assert.deepEqual(findingCheckPlaceholders({ title: "Platzhalter offen", problem: "In fragen-2 steht ein Platzhalter." }, blocks, ["fragen-2"]), [Q, "Andere Frage hier?"]);
assert.deepEqual(findingCheckPlaceholders({ title: "Zahl unbelegt", problem: "20.000 Kunden ist nicht belegt." }, blocks, ["fragen-2"]), []);
const notes = ["alt", kundePrueftNoteLine(Q)];
assert.deepEqual(kundePrueftQuestionsInNotes(notes), [Q]);
assert.deepEqual(answeredInNotes(notes), [{ question: Q, answer: "KUNDE PRÜFT" }]);
const html = markKundePrueftHtml(blocks[0]!.html, [Q]);
assert.ok(html.includes(`<strong>[KUNDE PRÜFT: ${Q}]</strong>`) && html.includes("[BITTE PRÜFEN: Andere Frage hier?]"));
assert.ok(htmlToMarkdown(html).includes(`**[KUNDE PRÜFT: ${Q}]**`));
assert.ok(htmlToPlainText(html).includes(`[KUNDE PRÜFT: ${Q}]`));
assert.equal(markKundePrueftHtml(blocks[0]!.html, []), blocks[0]!.html);
console.log("OK: KUNDE PRÜFT mark tests passed");
