/**
 * Open points about a word that is used too often: they are about every Abschnitt that uses the word,
 * not only the one (often the H1) the model pinned them to.
 *
 *   npx tsx scripts/test-content-finding-terms.ts
 */
import assert from "node:assert/strict";

import { TERM_TARGET_MAX, blocksUsingNamedTerm, findingTargetBlocks } from "../lib/dt/content/finding-target";
import type { ContentTextBlock } from "../lib/dt/content/render";

const block = (id: string, heading: string | null, html: string): ContentTextBlock => ({ id, heading, level: 2, html });

const BLOCKS: ContentTextBlock[] = [
  block("hero", "Darmsanierung in Köln", "<p>Ihre Praxis.</p>"),
  block("intro", "Was ist das?", "<p>Die Darmsanierung unterstützt den Darm. Eine Darmsanierung dauert Wochen.</p>"),
  block("ablauf", "Ablauf", "<p>Erst das Gespräch, dann der Plan für Ihre Darmsanierung.</p>"),
  block("preis", "Kosten", "<p>Die Kosten besprechen wir vorab.</p>"),
  block("faq", "Fragen", "<ul><li>Tut es weh?</li><li>Wie lange dauert die Darmsanierungskur?</li></ul>"),
];

function testTerms() {
  const finding = { block_id: "hero", problem: "Das Wort „Darmsanierung“ kommt zu oft im Text vor (5-mal).", proposal: "Durch Synonyme wie „Darmkur“ oder „Darmaufbau“ ersetzen." };
  assert.deepEqual(findingTargetBlocks(finding, BLOCKS), ["hero", "intro", "ablauf"], "pinned to the H1, but about every Abschnitt using the word (not the compound „Darmsanierungskur“)");
  const none = { block_id: null, problem: "Der Begriff Darmsanierung wird zu häufig wiederholt.", proposal: "Abwechslungsreicher formulieren." };
  assert.deepEqual(findingTargetBlocks(none, BLOCKS), ["hero", "intro", "ablauf"], "named after „Begriff“, no quotes");
  // Without a cue for repetition the point stays where the model put it.
  const pinned = { block_id: "ablauf", problem: "Das „Gespräch“ wird ohne Beleg als kostenlos beworben.", proposal: "Beleg ergänzen." };
  assert.deepEqual(findingTargetBlocks(pinned, BLOCKS), ["ablauf"], "a point about something else keeps its Abschnitt");
  // Nothing named, nothing known: still none.
  assert.deepEqual(findingTargetBlocks({ block_id: null, problem: "Der Text wirkt insgesamt zu lang.", proposal: "Kürzen." }, BLOCKS), []);
  // A word in too many Abschnitte is too common to follow.
  const common = Array.from({ length: TERM_TARGET_MAX + 2 }, (_, i) => block(`b${i}`, null, "<p>Wir helfen Ihnen gerne weiter.</p>"));
  assert.deepEqual(blocksUsingNamedTerm("Das Wort „Ihnen“ kommt zu oft vor.", common), []);
  assert.equal(blocksUsingNamedTerm("Das Wort „Ihnen“ kommt zu oft vor.", common.slice(0, 3)).length, 3);
  // Case and word boundaries.
  assert.deepEqual(blocksUsingNamedTerm("Das Wort „darm“ kommt zu oft vor.", BLOCKS), ["intro"], "whole words only: „Darmsanierung“ is another word, the case does not matter");
  console.log("terms: a repeated word reaches every Abschnitt that uses it; others stay: ok");
}

testTerms();
console.log("OK: content finding terms tests passed");
