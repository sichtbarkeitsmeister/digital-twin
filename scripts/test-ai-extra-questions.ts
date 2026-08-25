/**
 * Parse KI extra questions (objects, not String(obj) → [object Object]).
 * Run: npx tsx scripts/test-ai-extra-questions.ts
 */
import assert from "node:assert/strict";

import { clientAudienceVocab } from "../lib/surveys/client-audience";
import {
  extraGapHints,
  fallbackExtraQuestions,
  parseAiExtraQuestions,
} from "../lib/surveys/ai-extra-questions";

assert.deepEqual(parseAiExtraQuestions(null), []);
assert.deepEqual(parseAiExtraQuestions("[object Object]"), []);
assert.deepEqual(
  parseAiExtraQuestions([{ title: {} }, { question: 3 }, "x"]),
  [],
);

const fromStrings = parseAiExtraQuestions([
  "Welche Lasergeräte setzt die Praxis ein, und wofür?",
  "[object Object]",
  "kurz",
]);
assert.equal(fromStrings.length, 1);
assert.match(fromStrings[0]!.title, /Lasergeräte/);

const fromObjects = parseAiExtraQuestions([
  {
    title: "Arbeitet die Praxis nur privat, oder auch mit gesetzlich Versicherten?",
    description: "Wichtig für die Zielgruppe.",
    example: "Beides, gesetzlich nur bei ausgewählten Leistungen.",
  },
  {
    question: "Welche Hyaluron-Marken werden verwendet?",
    hint: "Markennamen in Texten.",
  },
  { title: "Welche Lasergeräte setzt die Praxis ein, und wofür?" },
]);
assert.equal(fromObjects.length, 3);
assert.match(fromObjects[0]!.description, /Zielgruppe/);
assert.match(fromObjects[0]!.description, /Beispiel:/);
assert.equal(fromObjects[1]!.title.includes("Hyaluron"), true);
assert.equal(fromObjects[2]!.title.startsWith("Welche Laser"), true);

const nested = parseAiExtraQuestions([
  { question: { text: "Gibt es Vorher-Nachher-Fotos, die veröffentlicht werden dürfen?" } },
]);
assert.equal(nested.length, 1);
assert.match(nested[0]!.title, /Vorher-Nachher/);

const skipObjectObject = parseAiExtraQuestions([
  { title: "[object Object]" },
  { title: "Welche Nachsorge gilt nach einer Behandlung?" },
]);
assert.equal(skipObjectObject.length, 1);
assert.match(skipObjectObject[0]!.title, /Nachsorge/);

const deduped = parseAiExtraQuestions(
  [
    "Welche Lasergeräte setzt die Praxis ein, und wofür?",
    "Welche Lasergeräte setzt die Praxis ein, und wofür?",
  ],
  { existingTitles: ["Welche Lasergeräte setzt die Praxis ein, und wofür?"] },
);
assert.equal(deduped.length, 0);

assert.match(extraGapHints("praxis"), /Geräte|Nachsorge/);
assert.equal(/Hyaluron|Arbeitsrecht|Spatenstich/.test(extraGapHints("praxis")), false);
assert.match(extraGapHints("praxis", "persona"), /Wunschmenschen|zusätzlich/);
assert.equal(/Nachsorge|Geräte/.test(extraGapHints("praxis", "persona")), false);
assert.match(extraGapHints("kanzlei"), /Mandat|Rechtsschutz/);
assert.equal(/Hyaluron|Laser|Botox/.test(extraGapHints("kanzlei")), false);

const praxisExtras = fallbackExtraQuestions({
  kind: "praxis",
  vocab: clientAudienceVocab("praxis"),
  services: ["Botox-Injektionen", "Hyaluronsäure-Filler"],
});
assert.equal(praxisExtras.length, 4);
assert.match(praxisExtras[0]!.title, /Botox-Injektionen/);
assert.match(praxisExtras.map((q) => q.title).join(" "), /gesetzlich|Nachsorge|Vorher-Nachher/);
assert.ok(praxisExtras.every((q) => /Beispiel/.test(q.description)));
assert.equal(/Mandat|Arbeitsrecht|Rechtsschutz/.test(praxisExtras.map((q) => q.title).join(" ")), false);

const kanzleiExtras = fallbackExtraQuestions({
  kind: "kanzlei",
  vocab: clientAudienceVocab("kanzlei"),
});
assert.equal(kanzleiExtras.length, 4);
assert.match(kanzleiExtras.map((q) => q.title).join(" "), /Gericht|Rechtsschutz|Mandat/);
assert.equal(/Hyaluron|Laser|Botox|Nachsorge/.test(kanzleiExtras.map((q) => q.title).join(" ")), false);
assert.match(kanzleiExtras[2]!.title, /Mandanten/);
assert.equal(/mandantenn/i.test(kanzleiExtras[2]!.title), false);

const personaFallbacks = fallbackExtraQuestions({
  kind: "praxis",
  vocab: clientAudienceVocab("praxis"),
  purpose: "persona",
});
assert.equal(personaFallbacks.length, 4);
assert.match(personaFallbacks.map((q) => q.title).join(" "), /Patient/);
assert.equal(
  /Nachsorge|Gerät|Vorher-Nachher|gesetzlich Versicherte/.test(
    personaFallbacks.map((q) => `${q.title} ${q.description}`).join(" "),
  ),
  false,
);

console.log("test-ai-extra-questions: ok");
