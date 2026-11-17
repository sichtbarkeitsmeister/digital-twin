/**
 * Duplicate content between the finished texts: what counts, what does not, how it is reported.
 *
 *   npx tsx scripts/test-content-duplicates.ts
 */
import assert from "node:assert/strict";

import { duplicateFindingsForPage, duplicateSeverity, findDuplicateContent, type DuplicateInputPage } from "../lib/dt/content/duplicates";
import { loadDuplicateFindings } from "../lib/dt/content/pipeline/duplicate-findings";
import type { EndabnahmeOutput } from "../lib/dt/content/pipeline/prompts";
import { stepPatchFor } from "../lib/dt/content/pipeline/step-patch";
import { CONTENT_STEP_ENDABNAHME, CONTENT_STEP_SEO, contentStepDefinition } from "../lib/dt/content/pipeline/steps";

const section = (id: string, heading: string, ...paragraphs: string[]) =>
  `<section data-block-id="${id}"><h2>${heading}</h2>\n${paragraphs.map((p) => `<p>${p}</p>`).join("\n")}</section>`;

const SHARED =
  "Beim Ankauf von Silberbesteck prüfen wir zuerst Stempel und Gewicht, danach nennen wir Ihnen einen fairen Preis und holen die Stücke bei Ihnen zu Hause in Düsseldorf ab.";
const CTA = "Rufen Sie uns gerne an oder schreiben Sie uns eine Nachricht, wir melden uns innerhalb eines Werktages bei Ihnen zurück und beantworten alle offenen Fragen.";

const PAGES: DuplicateInputPage[] = [
  {
    slug: "silber",
    name: "Silber Ankauf",
    html: [
      section("intro", "Silber verkaufen", SHARED, "Silber verkaufen ist einfacher als gedacht, denn wir kümmern uns um alles und sind seit vielen Jahren in der Region unterwegs."),
      section("kontakt", "Kontakt", CTA),
    ].join("\n"),
  },
  {
    slug: "besteck",
    name: "Besteck Ankauf",
    html: [
      // the same paragraph with two words changed: nearly the same
      section("intro", "Besteck verkaufen", SHARED.replace("fairen", "guten").replace("Stücke", "Teile"), "Ganz andere Sätze über Servierbesteck, Tafelmesser und Löffel aus Familienbesitz, die ihren eigenen Wert haben."),
      section("kontakt", "Kontakt", CTA),
    ].join("\n"),
  },
  {
    slug: "uhren",
    name: "Uhren Ankauf",
    html: [section("intro", "Uhren verkaufen", "Uhren aus Nachlässen bewerten wir nach Hersteller, Zustand, Werk und Papieren, bevor wir ein Angebot machen, das Sie in Ruhe prüfen können."), section("kontakt", "Kontakt", CTA)].join("\n"),
  },
  { slug: "schmuck", name: "Schmuck Ankauf", html: section("kontakt", "Kontakt", CTA) },
  { slug: "leer", name: "Ohne Text", html: "" },
];

function testReport() {
  const report = findDuplicateContent(PAGES);
  assert.equal(report.pages, 5);
  assert.equal(report.pairs.length, 1, "only Silber/Besteck repeat a paragraph; the contact call is a standard text");
  const pair = report.pairs[0]!;
  assert.deepEqual([pair.a.slug, pair.b.slug], ["besteck", "silber"], "pairs are ordered by slug");
  assert.equal(pair.matches.length, 1);
  assert.equal(pair.matches[0]!.level, "aehnlich", "two words changed: very similar, not word for word");
  assert.ok(pair.matches[0]!.similarity >= 0.5 && pair.matches[0]!.similarity < 1);
  assert.equal(pair.matches[0]!.a.blockId, "intro");
  assert.ok(pair.shareA > 0.3 && pair.shareB > 0.3, `half of each short text: ${pair.shareA.toFixed(2)} / ${pair.shareB.toFixed(2)}`);
  assert.equal(duplicateSeverity(pair), "hoch");

  assert.equal(report.standardTexts.length, 1, "the same call on four pages is a standard text");
  assert.equal(report.standardTexts[0]!.pages.length, 4);
  assert.match(report.standardTexts[0]!.text, /^Rufen Sie uns gerne an/);
  console.log("report: a nearly repeated paragraph is a pair, the shared contact call is a standard text: ok");
}

function testNoFalseHits() {
  const unrelated = findDuplicateContent([
    { slug: "a", name: "A", html: section("x", "A", "Wir bewerten Gemälde und Grafiken aus Nachlässen nach Künstler, Signatur, Erhaltungszustand und Herkunft und beraten Sie ehrlich zum Wert.") },
    { slug: "b", name: "B", html: section("x", "B", "Teppiche aus Wolle und Seide werden nach Knüpfdichte, Alter, Farben und Provenienz eingeschätzt, bevor ein transparentes Angebot entsteht.") },
  ]);
  assert.equal(unrelated.pairs.length, 0, "different paragraphs on the same topic are no duplicates");
  const short = findDuplicateContent([
    { slug: "a", name: "A", html: section("x", "A", "Rufen Sie uns an.") },
    { slug: "b", name: "B", html: section("x", "B", "Rufen Sie uns an.") },
  ]);
  assert.equal(short.pairs.length, 0, "very short paragraphs are not compared");
  const sameHeadings = findDuplicateContent([
    { slug: "a", name: "A", html: `<section data-block-id="x"><h2>Ablauf des Ankaufs bei uns in Düsseldorf</h2></section>` },
    { slug: "b", name: "B", html: `<section data-block-id="x"><h2>Ablauf des Ankaufs bei uns in Düsseldorf</h2></section>` },
  ]);
  assert.equal(sameHeadings.pairs.length, 0, "headings are not compared");
  const sameBlock = findDuplicateContent([{ slug: "a", name: "A", html: section("x", "A", SHARED, SHARED) }]);
  assert.equal(sameBlock.pairs.length, 0, "a page is not compared with itself");
  console.log("no false hits: unrelated, short, headings, same page: ok");
}

function testFindings() {
  const report = findDuplicateContent(PAGES);
  const findings = duplicateFindingsForPage(report, "silber");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.title, "Doppelter Inhalt mit „Besteck Ankauf“");
  assert.match(findings[0]!.problem, /1 Absatz steht fast gleich auch auf der Seite „Besteck Ankauf“ \(etwa \d+ % dieses Textes\)/);
  assert.equal(findings[0]!.block_id, "intro", "the open point points at the Abschnitt on this page");
  assert.equal(findings[0]!.severity, "high");
  assert.deepEqual(duplicateFindingsForPage(report, "uhren"), [], "a page without a repeat gets none");
  assert.deepEqual(duplicateFindingsForPage(report, "unbekannt"), []);

  // About half of one paragraph shared: shown in the card, not yet listed as an open point.
  const weak = findDuplicateContent([
    { slug: "a", name: "A", html: section("x", "A", "Wir holen Ihre Stücke kostenlos bei Ihnen zu Hause in Düsseldorf ab und zahlen den vereinbarten Preis sofort in bar aus, ohne versteckte Gebühren.") },
    { slug: "b", name: "B", html: section("x", "B", "Wir holen Ihre Stücke kostenlos bei Ihnen daheim in Düsseldorf ab und zahlen den vereinbarten Preis sofort bar aus, ganz ohne versteckte Kosten.") },
  ]);
  assert.equal(weak.pairs.length, 1);
  assert.ok(weak.pairs[0]!.matches[0]!.similarity >= 0.5 && weak.pairs[0]!.matches[0]!.similarity < 0.6);
  assert.deepEqual(duplicateFindingsForPage(weak, "a"), [], "one half-alike paragraph is shown in the card, not listed as an open point");
  // Two alike paragraphs are listed, even if neither is close to word for word.
  const two = findDuplicateContent([
    { slug: "a", name: "A", html: section("x", "A", "Wir holen Ihre Stücke kostenlos bei Ihnen zu Hause in Düsseldorf ab und zahlen den vereinbarten Preis sofort in bar aus, ohne versteckte Gebühren.", "Unsere Fachleute prüfen jedes einzelne Teil sorgfältig auf Echtheit, Alter und Zustand, bevor sie Ihnen ein verbindliches Angebot machen.") },
    { slug: "b", name: "B", html: section("x", "B", "Wir holen Ihre Stücke kostenlos bei Ihnen daheim in Düsseldorf ab und zahlen den vereinbarten Preis sofort bar aus, ganz ohne versteckte Kosten.", "Unsere Fachleute prüfen jedes einzelne Teil sorgfältig auf Echtheit, Alter und Zustand, bevor sie Ihnen ein verbindliches Angebot machen und erklären.") },
  ]);
  assert.equal(two.pairs[0]!.matches.length, 2);
  assert.equal(duplicateFindingsForPage(two, "b").length, 1, "two alike paragraphs make one open point for the other page");
  console.log("findings: one per repeating page, points at the Abschnitt, weak ones stay out: ok");
}

function testSpeed() {
  const many = Array.from({ length: 150 }, (_, i) => ({
    slug: `p${i}`,
    name: `Seite ${i}`,
    html: section("a", "A", `Seite ${i} behandelt das Thema ${i} mit eigenen Worten und eigenen Beispielen aus dem Alltag Nummer ${i * 7} im Raum ${i % 11}, damit jeder Absatz anders klingt.`, `Dazu kommt ein zweiter Absatz ${i} über Ablauf ${i * 3}, Kosten ${i * 5} und Termine ${i * 13}, die sich je Seite unterscheiden und deshalb nicht doppelt sind.`),
  }));
  const started = Date.now();
  const report = findDuplicateContent(many);
  assert.equal(report.pairs.length, 0);
  assert.ok(Date.now() - started < 3_000, "150 pages stay quick");
  console.log("speed: 150 pages: ok");
}

async function testPipeline() {
  // The Endabnahme lists what the text repeats, next to its own open points; it never blocks.
  const findings = duplicateFindingsForPage(findDuplicateContent(PAGES), "silber");
  const out: EndabnahmeOutput = { unresolved: [], summary: "Fast fertig." };
  const patch = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, out, { html: PAGES[0]!.html, duplicateFindings: findings });
  assert.deepEqual((patch.pagePatch.unresolved as Array<{ title: string }>).map((f) => f.title).filter((t) => t.startsWith("Doppelter Inhalt")), ["Doppelter Inhalt mit „Besteck Ankauf“"]);
  assert.equal(patch.pagePatch.state, "fertig", "the page still finishes: an open point is a warning for the release");
  const without = stepPatchFor(contentStepDefinition(CONTENT_STEP_ENDABNAHME)!, out, { html: PAGES[0]!.html });
  assert.ok(!(without.pagePatch.unresolved as Array<{ title: string }>).some((f) => f.title.startsWith("Doppelter Inhalt")), "no duplicate findings given, none listed");

  // The loader reads the other texts from the database; a failure gives no findings and no error.
  const rows = PAGES.filter((p) => p.html).map((p) => ({ slug: p.slug, name: p.name, html: p.html }));
  const chain = (result: { data: unknown; error: { message: string } | null }) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => void) => resolve(result);
    return c;
  };
  const okService = { from: () => chain({ data: rows, error: null }) } as never;
  const found = await loadDuplicateFindings(okService, { organisation_id: "o", slug: "besteck" });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.title, "Doppelter Inhalt mit „Silber Ankauf“");
  const brokenService = { from: () => chain({ data: null, error: { message: "db down" } }) } as never;
  assert.deepEqual(await loadDuplicateFindings(brokenService, { organisation_id: "o", slug: "besteck" }), []);
  assert.notEqual(CONTENT_STEP_SEO, CONTENT_STEP_ENDABNAHME);
  console.log("pipeline: Endabnahme lists the repeats, never blocks, failures give none: ok");
}

testReport();
testNoFalseHits();
testFindings();
testSpeed();
void testPipeline()
  .then(() => console.log("OK: content duplicates tests passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
