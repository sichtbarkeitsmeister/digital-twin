/**
 * Client audience vocab for Fragebogen wizard (Kunde / Patient / Mandant).
 * Run: npx tsx scripts/test-client-audience.ts
 */
import assert from "node:assert/strict";

import {
  applyClientAudienceToText,
  clientAudienceVocab,
  isClientAudienceKind,
} from "../lib/surveys/client-audience";
import { customizeCoreQuestion } from "../lib/surveys/customize-fragebogen";
import {
  ANBIETER_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
  isIndustryPlaceholderLabel,
  surveyInfoTextForPurpose,
} from "../lib/surveys/core-question-templates";

assert.equal(isClientAudienceKind("kanzlei"), true);
assert.equal(isClientAudienceKind("praxis"), true);
assert.equal(isClientAudienceKind("unternehmen"), true);
assert.equal(isClientAudienceKind("kunde"), false);

assert.equal(clientAudienceVocab("kanzlei").singular, "Mandant");
assert.equal(clientAudienceVocab("praxis").singular, "Patient");
assert.equal(clientAudienceVocab("unternehmen").singular, "Kunde");

const kanzlei = applyClientAudienceToText(
  "Wie lässt sich dieser ideale Kunde beschreiben? Mit welchen Kundentypen wird nicht zusammengearbeitet? Firmensitz und Auftrag.",
  "kanzlei",
  { replaceBusiness: true },
);
assert.match(kanzlei, /ideale Mandant/);
assert.match(kanzlei, /Mandantentypen/);
assert.match(kanzlei, /Kanzleisitz/);
assert.match(kanzlei, /Mandat/);
assert.equal(/Kunde/.test(kanzlei), false);

const praxis = applyClientAudienceToText(
  "Dieser Kunde kommt aus der Region. Die Firma bleibt die Praxis.",
  "praxis",
  { replaceBusiness: true },
);
assert.match(praxis, /Dieser Patient/);
assert.match(praxis, /Die Praxis bleibt die Praxis/);

assert.equal(
  applyClientAudienceToText("Wunschkunde Julia", "kanzlei"),
  "Wunschmandant Julia",
);
assert.equal(applyClientAudienceToText("Das Unternehmen", "kanzlei"), "Das Unternehmen");
assert.equal(
  applyClientAudienceToText("Das Unternehmen", "kanzlei", { replaceBusiness: true }),
  "Die Kanzlei",
);
assert.equal(
  applyClientAudienceToText("Das Unternehmen", "praxis", { replaceBusiness: true }),
  "Die Praxis",
);
assert.equal(
  applyClientAudienceToText("Dieser Kunde braucht Hilfe.", "unternehmen"),
  "Dieser Kunde braucht Hilfe.",
);

const infoKanzlei = surveyInfoTextForPurpose("persona", "kanzlei");
assert.match(infoKanzlei.infoText, /Mandant/);
assert.equal(/Kunde/.test(infoKanzlei.infoText.replace(/Wunsch/g, "")), false);

const portfolio = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "portfolio");
assert.ok(portfolio);
assert.equal(isIndustryPlaceholderLabel(portfolio.options?.[0]?.label ?? ""), true);

const customized = customizeCoreQuestion({
  template: portfolio,
  audience: "kanzlei",
  serviceLabels: ["Arbeitsrecht", "Familienrecht", "Mietrecht"],
});
assert.deepEqual(
  customized.options?.map((o) => o.label),
  ["Arbeitsrecht", "Familienrecht", "Mietrecht"],
);
assert.match(customized.description, /Mandant|angeboten/);

const personaHold = PERSONA_CORE_QUESTIONS.find((q) => q.key === "persona_hold_back");
assert.ok(personaHold);
const holdKanzlei = customizeCoreQuestion({
  template: personaHold,
  audience: "kanzlei",
});
assert.match(holdKanzlei.title, /Mandant/);
assert.equal(/Kunde/.test(holdKanzlei.title), false);

console.log("client-audience: ok");
