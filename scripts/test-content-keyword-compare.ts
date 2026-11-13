/**
 * Comparing keywords across pages (duplicate content) and spotting entries that are no keywords.
 *
 *   npx tsx scripts/test-content-keyword-compare.ts
 */
import assert from "node:assert/strict";

import { parseKeywordsCell } from "../lib/dt/content/excel-structure";
import {
  describeKeywordConflict,
  findKeywordConflicts,
  keywordJunkReason,
  keywordMatch,
  keywordTaken,
} from "../lib/dt/content/keyword-compare";
import { mainKeywordTakenBy } from "../lib/dt/content/store";

function testMatch() {
  assert.equal(keywordMatch("Silber Ankauf Düsseldorf", "silber-ankauf düsseldorf"), "gleich", "case and punctuation");
  assert.equal(keywordMatch("Antiquitäten Ankauf", "Ankauf Antiquitäten"), "gleich", "word order");
  assert.equal(keywordMatch("Silberankauf Düsseldorf", "Silber Ankauf Düsseldorf"), "gleich", "compound and split");
  assert.equal(keywordMatch("Antiquitäten Ankauf in Düsseldorf", "Antiquitäten Ankauf Düsseldorf"), "gleich", "small words");
  assert.equal(keywordMatch("Antiquitäten Ankauf", "Antiquität Ankauf"), "aehnlich", "inflection");
  assert.equal(keywordMatch("Kunst Ankauf Düsseldorf", "Kunsthändler Ankauf Düsseldorf"), null, "different searches stay different");
  assert.equal(keywordMatch("Silber Ankauf", "Silber Ankauf Düsseldorf"), null, "a longer, more specific keyword is not a duplicate");
  assert.equal(keywordMatch("Ankauf", "Verkauf"), null);
  assert.equal(keywordMatch("in der", "in der"), null, "nothing but small words matches nothing");
  assert.equal(keywordTaken("Antiquität Ankauf", ["Antiquitäten Ankauf"], false), false, "similar only counts when asked for");
  assert.equal(keywordTaken("Antiquität Ankauf", ["Antiquitäten Ankauf"], true), true);
  console.log("match: same search, order, compound, inflection; no false hits: ok");
}

function testConflicts() {
  const pages = [
    { slug: "start", name: "Startseite", main: "Antiquitäten Ankauf Düsseldorf", secondary: ["Antiquitäten verkaufen"] },
    { slug: "antik", name: "Antiquitäten Ankauf", main: "Ankauf Antiquitäten Düsseldorf", secondary: [] },
    { slug: "silber", name: "Silber Ankauf", main: "Silber Ankauf", secondary: ["Silberankauf Düsseldorf"] },
    { slug: "silber2", name: "Silberankauf", main: "Silberankauf Düsseldorf", secondary: [] },
    { slug: "keramik", name: "Keramik", main: "Keramik Ankauf", secondary: ["Antiquitäten verkaufen"] },
    { slug: "ratgeber", name: "Ratgeber", main: "Antiquitäten verkaufen", secondary: [] },
    { slug: "leer", name: "Ohne", main: null, secondary: [] },
  ];
  const conflicts = findKeywordConflicts(pages);
  const kinds = (slug: string) => (conflicts.get(slug) ?? []).map((c) => `${c.kind}:${c.level}:${c.otherSlug}`).sort();
  assert.deepEqual(kinds("start"), ["haupt_haupt:gleich:antik", "neben_haupt:gleich:ratgeber"], "same main keyword in another order; its Nebenkeyword is the Ratgeber's main keyword");
  assert.deepEqual(kinds("antik"), ["haupt_haupt:gleich:start"]);
  assert.deepEqual(kinds("silber"), ["neben_haupt:gleich:silber2"], "a Nebenkeyword that is another page's main keyword");
  assert.deepEqual(kinds("silber2"), ["haupt_neben:gleich:silber"]);
  assert.deepEqual(kinds("ratgeber"), ["haupt_neben:gleich:keramik", "haupt_neben:gleich:start"], "its main keyword sits as Nebenkeyword on two pages");
  assert.deepEqual(kinds("keramik"), ["neben_haupt:gleich:ratgeber"]);
  assert.equal(conflicts.has("leer"), false);
  assert.equal(findKeywordConflicts([{ slug: "a", name: "A", main: "Ankauf", secondary: ["Ankauf"] }]).size, 0, "a page does not clash with itself");
  const line = describeKeywordConflict(conflicts.get("start")![0]!);
  assert.equal(line, "Hauptkeyword wie „Antiquitäten Ankauf“: dasselbe Hauptkeyword („Ankauf Antiquitäten Düsseldorf“)");
  assert.equal(describeKeywordConflict(conflicts.get("silber2")![0]!), "Das Hauptkeyword steht bei „Silber Ankauf“ als Nebenkeyword");
  // Hundreds of pages: no pairwise comparison, still quick.
  const many = Array.from({ length: 800 }, (_, i) => ({ slug: `p${i}`, name: `P${i}`, main: `Leistung ${i} Düsseldorf`, secondary: [`Variante ${i}`, `Begriff ${i} Köln`] }));
  const started = Date.now();
  assert.equal(findKeywordConflicts(many).size, 0);
  assert.ok(Date.now() - started < 3_000, "800 pages stay quick");
  console.log("conflicts: main/main, main/secondary, no self-clash, quick: ok");
}

function testTakenBy() {
  const pages = [{ slug: "start", name: "Startseite", main_keyword: null, keywords: { main: { text: "Heilpraktiker Köln" }, secondary: [] } }];
  assert.deepEqual(mainKeywordTakenBy(pages, "x", "Köln Heilpraktiker"), { slug: "start", name: "Startseite" }, "also another word order");
  assert.equal(mainKeywordTakenBy(pages, "x", "Heilpraktiker Köln Süd"), null);
  const inflected = [{ slug: "a", name: "A", main_keyword: "Antiquitäten Ankauf", keywords: null }];
  assert.equal(mainKeywordTakenBy(inflected, "x", "Antiquität Ankauf"), null, "by hand only the same search blocks");
  assert.deepEqual(mainKeywordTakenBy(inflected, "x", "Antiquität Ankauf", { similar: true }), { slug: "a", name: "A" }, "the analysis also avoids close variants");
  console.log("taken by another page: order-free, similar on request: ok");
}

function testJunk() {
  for (const text of ["geschätzter Traffic bei Google / Monat", "Traffic", "Suchvolumen", "Keywords", "Hauptkeyword", "590", "1.200 / Monat", "https://example.org/a", "/ankauf", "n/a", "x ".repeat(12).trim()]) {
    assert.ok(keywordJunkReason(text), `junk: ${text}`);
  }
  for (const text of ["Antiquitäten Ankauf", "Heilpraktiker Köln", "Silberankauf Düsseldorf", "Ankauf von Nachlässen", "Praxis für Naturheilkunde"]) {
    assert.equal(keywordJunkReason(text), null, `no junk: ${text}`);
  }
  assert.equal(keywordJunkReason("geschätzter Traffic bei Google / Monat"), "einer Spaltenüberschrift oder Beschreibung");
  assert.equal(parseKeywordsCell("geschätzter Traffic bei Google / Monat"), null, "the Excel import drops a header left in the cell");
  assert.deepEqual(parseKeywordsCell("Traffic, Akupunktur Köln (320), TCM Köln"), { main: { text: "Akupunktur Köln", volume: 320 }, secondary: [{ text: "TCM Köln" }] }, "the real keywords stay");
  console.log("junk: headers, numbers, addresses out; real keywords stay: ok");
}

testMatch();
testConflicts();
testTakenBy();
testJunk();
console.log("OK: content keyword compare tests passed");
