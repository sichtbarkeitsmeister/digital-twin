import assert from "node:assert/strict";

import {
  isCompleteQuestionnairePaste,
  isPasteRetryOrConfirmIntent,
  resolveQuestionnairePasteSource,
} from "../lib/ai/survey-markdown-paste";

function buildPaste(): string {
  const sections = [
    "Über dich und deine Rolle",
    "Angebot und Leistungen",
    "Zielgruppe und Positionierung",
    "Ziele und Erfolgsmessung",
  ];
  const lines = ["# Kundenfragebogen", "", "Bitte diesen Fragebogen anlegen und abspeichern.", ""];

  sections.forEach((section, sectionIndex) => {
    lines.push(`## ${sectionIndex + 1}. ${section}`, "");
    for (let q = 1; q <= 4; q += 1) {
      lines.push(
        `**Frage ${sectionIndex * 4 + q}: Beschreibe ausführlich, wie ${section.toLowerCase()} bei euch aussieht**`,
        "",
        "Bitte antworte in ganzen Sätzen und nenne konkrete Beispiele aus dem Alltag, damit der Avatar später präzise formulieren kann.",
        "",
      );
    }
  });

  return lines.join("\n");
}

const paste = buildPaste();

function testPasteIsRecognised() {
  assert.equal(isCompleteQuestionnairePaste(paste), true);
  assert.equal(resolveQuestionnairePasteSource({ userMessage: paste }), paste);
  console.log("paste recognised: ok");
}

function testRetryReusesPaste() {
  for (const retry of ["versuche es erneut", "Nochmal bitte", "bitte übernehmen", "genau so"]) {
    assert.equal(isPasteRetryOrConfirmIntent(retry), true, retry);
    assert.equal(
      resolveQuestionnairePasteSource({
        userMessage: retry,
        priorUserMessages: [paste],
      }),
      paste,
      retry,
    );
  }
  console.log("retry reuses paste: ok");
}

function testBareConfirmationsAreIgnored() {
  // These approve whatever the assistant proposed last — re-importing the whole
  // questionnaire instead would hide the answer the user asked for.
  for (const confirm of ["ja", "ok", "okay", "bitte", "los", "mach das", "speichern"]) {
    assert.equal(isPasteRetryOrConfirmIntent(confirm), false, confirm);
    assert.equal(
      resolveQuestionnairePasteSource({
        userMessage: confirm,
        priorUserMessages: [paste],
      }),
      null,
      confirm,
    );
  }
  console.log("bare confirmations ignored: ok");
}

function testLookbackIsLimited() {
  const chatter = ["Feld 3 umbenennen", "Abschnitt 2 nach oben", "Titel ändern"];

  // Directly after the paste the retry still finds it.
  assert.equal(
    resolveQuestionnairePasteSource({
      userMessage: "versuche es erneut",
      priorUserMessages: [paste, chatter[0]!],
    }),
    paste,
  );

  // Several unrelated turns later it must not resurface.
  assert.equal(
    resolveQuestionnairePasteSource({
      userMessage: "versuche es erneut",
      priorUserMessages: [paste, ...chatter],
    }),
    null,
  );
  console.log("lookback limited: ok");
}

testPasteIsRecognised();
testRetryReusesPaste();
testBareConfirmationsAreIgnored();
testLookbackIsLimited();
console.log("All survey paste retry tests passed.");
