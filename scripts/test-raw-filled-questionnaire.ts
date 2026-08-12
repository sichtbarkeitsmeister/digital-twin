import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isRawFilledQuestionnaire,
  parseRawFilledQuestionnaire,
  splitCheckboxLabels,
  splitRankingLabels,
  splitRawFilledDocuments,
} from "../lib/surveys/raw-filled-questionnaire";

const SAMPLE = `Wunschkunde & Avatar
5 Felder
Auf welchen Wunschkunden konzentriert sich dieser Fragebogen?

Bitte alle zutreffenden Kundentypen ankreuzen.

Antwort: Privatperson nach Todesfall (Angehörige, Erben) – ruft selbst an und entscheidet selbst, Makler / Hausverwaltung – beauftragt nach Tod des Mieters, Gesetzlicher Vertreter / Betreuer des Verstorbenen – handelt im Auftrag

Wie soll der digitale Kunden-Avatar heißen?

Ein typischer Vorname, der zu diesen Kunden passt – z. B. "Thomas", "Sabine", "Michael", "Andrea".

Antwort: Alex Müller

Wie würden Sie den idealen Wunschkunden einem Freund beschreiben?

z. B. ungefähres Alter, Situation, warum die Zusammenarbeit mit diesem Kundentyp am meisten Spaß macht. Bitte 2–3 vollständige Sätze.

Antwort: ab 60 Jahre (Privatperson), Markler & gesetzlicher Vertreter ist das Alter egal.

Welche Situation hat diese Wunschkunden zu Einfach Entrümpelung geführt?

Bitte alle häufig vorkommenden Situationen ankreuzen.

Antwort: Elternteil verstorben – Kind muss die Wohnung räumen lassen, Großelternteil verstorben – Enkel oder Kinder müssen räumen, Partner / Ehepartner verstorben

Wer meldet sich meistens zuerst – und warum gerade diese Person?

z. B. "Der älteste Sohn".

Antwort: Erwachsene Kinder (30-60 Jahre), gesetzliche Betreuer oder Makler

Demografie & Lebenssituation
4 Felder
Wie alt sind diese Wunschkunden meistens?

Bitte nach Häufigkeit sortieren (oben = häufigste Altersgruppe).

Antwort: 1. Über 65 Jahre, 2. 55–65 Jahre, 3. 45–55 Jahre

Was machen diese Wunschkunden beruflich?

Bitte ankreuzen, was häufig vorkommt.

Antwort: Angestellte / Bürojobs, Selbstständige / Unternehmer, Rentner / Pensionäre

Wo wohnen diese Wunschkunden?

Im Vergleich zur Wohnung, die geräumt werden soll.

Antwort: Oft in einer anderen Stadt

Abschlussfragen
2 Felder
Gibt es noch etwas Wichtiges über diese Wunschkunden, das wir noch nicht gefragt haben?

z. B. typische Situationen.

Antwort: nichts.

Bitte den idealen Wunschkunden in 3–5 Sätzen beschreiben – so wie Sie ihn einem Freund erklären würden.

Wer ist diese Person, was ist ihre Situation, warum lief die Zusammenarbeit so gut?

Antwort: Mein Wunschkunde sind große Projekte. Große Häuser oder Firmen.
`;

function testDetection() {
  assert.equal(isRawFilledQuestionnaire(SAMPLE), true);
  assert.equal(isRawFilledQuestionnaire('{"version":1}'), false);
  assert.equal(isRawFilledQuestionnaire("kurz"), false);
  console.log("detection: ok");
}

function testSplits() {
  const ranking = splitRankingLabels(
    "1. Über 65 Jahre, 2. 55–65 Jahre, 3. 45–55 Jahre",
  );
  assert.deepEqual(ranking, ["Über 65 Jahre", "55–65 Jahre", "45–55 Jahre"]);

  const boxes = splitCheckboxLabels(
    "Privatperson nach Todesfall (Angehörige, Erben) – ruft selbst an, Makler / Hausverwaltung – beauftragt nach Tod",
  );
  assert.equal(boxes.length, 2);
  assert.match(boxes[0]!, /Privatperson/);
  assert.match(boxes[1]!, /Makler/);
  console.log("splits: ok");
}

function testParse() {
  const parsed = parseRawFilledQuestionnaire(SAMPLE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.data.stepCount, 3);
  assert.ok(parsed.data.fieldCount >= 10);
  assert.ok(parsed.data.answeredCount >= 10);

  const avatarName = parsed.data.survey.steps[0]?.fields.find((f) =>
    /Avatar heißen/i.test(f.title),
  );
  assert.ok(avatarName);
  assert.equal(avatarName!.type, "text");
  assert.equal(parsed.data.answers[avatarName!.id], "Alex Müller");

  const age = parsed.data.survey.steps[1]?.fields.find((f) =>
    /Wie alt/i.test(f.title),
  );
  assert.ok(age);
  assert.equal(age!.type, "ranking");
  assert.equal(age!.type === "ranking" ? age!.options.length : 0, 3);

  const ageAnswer = parsed.data.answers[age!.id] as {
    items: Array<{ label: string }>;
  };
  assert.equal(ageAnswer.items[0]?.label, "Über 65 Jahre");

  const wish = parsed.data.survey.steps[0]?.fields.find((f) =>
    /Auf welchen Wunschkunden/i.test(f.title),
  );
  assert.ok(wish);
  assert.equal(wish!.type, "checkbox");
  assert.ok(wish!.type === "checkbox" && wish!.options.length >= 2);

  console.log(
    `parse: ok (${parsed.data.fieldCount} fields, ${parsed.data.answeredCount} answers)`,
  );
}

function testFileSampleIfPresent() {
  try {
    const text = readFileSync("/tmp/sample-raw-fragebogen.txt", "utf8");
    if (!isRawFilledQuestionnaire(text)) {
      console.log("file sample: skipped (not detected)");
      return;
    }
    const parsed = parseRawFilledQuestionnaire(text);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.ok(parsed.data.answeredCount >= 5);
      console.log(
        `file sample: ok (${parsed.data.fieldCount} fields, ${parsed.data.answeredCount} answers)`,
      );
    }
  } catch {
    console.log("file sample: skipped");
  }
}

testDetection();
testSplits();
testParse();
testFileSampleIfPresent();
testMultiDocumentSplit();
console.log("raw-filled-questionnaire: all ok");

function testMultiDocumentSplit() {
  const withSep = `${SAMPLE}\n=====\nAnbieter Kenntnisse\n3 Felder\nWas bietet ihr an?\n\nAntwort: Entrümpelung\n\nWie lange gibt es euch?\n\nAntwort: 13 Jahre\n\nWo seid ihr aktiv?\n\nAntwort: Düsseldorf\n`;
  const parts = splitRawFilledDocuments(withSep);
  assert.equal(parts.length, 2, "separator should yield 2 docs");

  const concatenated = `${SAMPLE}\n\nAnbieter & Leistungen\n3 Felder\nWas ist euer Kernangebot?\n\nBitte kurz beschreiben.\n\nAntwort: Entrümpelung und Haushaltsauflösung\n\nWelche Regionen bedient ihr?\n\nAntwort: Düsseldorf und Umgebung\n\nWie viele Mitarbeiter?\n\nAntwort: 8\n`;
  const auto = splitRawFilledDocuments(concatenated);
  assert.ok(auto.length >= 2, `auto-split expected >=2, got ${auto.length}`);
  console.log(`multi-doc split: ok (sep=${parts.length}, auto=${auto.length})`);
}
