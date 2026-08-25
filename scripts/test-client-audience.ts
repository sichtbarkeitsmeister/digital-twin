/**
 * Client audience vocab for Fragebogen wizard (Kunde / Patient / Mandant).
 * Run: npx tsx scripts/test-client-audience.ts
 */
import assert from "node:assert/strict";

import {
  applyClientAudienceToText,
  audienceWordingPreview,
  clientAudienceVocab,
  isClientAudienceKind,
  mergeAudienceVocab,
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
assert.equal(isClientAudienceKind("handwerk"), true);
assert.equal(isClientAudienceKind("unternehmen"), true);
assert.equal(isClientAudienceKind("kunde"), false);

assert.equal(clientAudienceVocab("kanzlei").singular, "Mandant");
assert.equal(clientAudienceVocab("praxis").singular, "Patient");
assert.equal(clientAudienceVocab("praxis").engagement, "Behandlung");
assert.equal(clientAudienceVocab("handwerk").business, "Betrieb");
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
  applyClientAudienceToText("Das Unternehmen", "handwerk", { replaceBusiness: true }),
  "Der Betrieb",
);
assert.equal(applyClientAudienceToText("Mandant und Mandat", "kanzlei"), "Mandant und Mandat");
assert.match(applyClientAudienceToText("Auftrag vom Kunden", "kanzlei"), /Mandat vom Mandanten/);

const praxisMandatExample = applyClientAudienceToText(
  "z. B. „Jedes Mandat ist anders“ oder „Transparente Festpreise sollen Hürden senken“.",
  "praxis",
);
assert.match(praxisMandatExample, /Jede Behandlung ist anders/);
assert.equal(/Mandat/.test(praxisMandatExample), false);

const praxisOrder = applyClientAudienceToText(
  "Ab welchem ungefähren Auftragswert lohnt sich ein Auftrag wirklich – weil der Auftrag zu klein ist?",
  "praxis",
);
assert.match(praxisOrder, /Behandlungswert/);
assert.match(praxisOrder, /eine Behandlung/);
assert.match(praxisOrder, /die Behandlung zu klein/);
assert.equal(/ein Behandlung/.test(praxisOrder), false);
assert.equal(/Auftrag/.test(praxisOrder), false);

const customHandwerk = mergeAudienceVocab("handwerk", {
  business: "Handwerker",
  businessPlural: "Handwerker",
  businessGender: "m",
});
assert.match(
  applyClientAudienceToText("Die Firma hilft dem Kunden.", customHandwerk, {
    replaceBusiness: true,
  }),
  /Der Handwerker hilft dem Kunden/,
);

const preview = audienceWordingPreview(clientAudienceVocab("praxis"));
assert.match(preview, /Praxis/);
assert.match(preview, /Patient/);
assert.match(preview, /Behandlung/);
assert.equal(/Mandat/.test(preview), false);

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

const reason = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "price_communication_reason");
assert.ok(reason);
const praxisReason = customizeCoreQuestion({ template: reason, audience: "praxis" });
assert.match(praxisReason.description, /Jede Behandlung ist anders/);
assert.equal(/Mandat/.test(praxisReason.description), false);

assert.equal(
  applyClientAudienceToText("während eines Projekts", "praxis"),
  "während einer Behandlung",
);
assert.equal(
  applyClientAudienceToText("während eines Auftrags", "praxis"),
  "während einer Behandlung",
);
assert.match(
  applyClientAudienceToText("passt am besten zum Unternehmen", "praxis", { replaceBusiness: true }),
  /zur Praxis/,
);
assert.match(
  applyClientAudienceToText("passt am besten zum Unternehmen", "handwerk", { replaceBusiness: true }),
  /zum Betrieb/,
);
assert.equal(
  applyClientAudienceToText("passt am besten zum Unternehmen", "unternehmen", {
    replaceBusiness: true,
  }),
  "passt am besten zum Unternehmen",
);
assert.equal(
  applyClientAudienceToText("bei jedem Auftrag besonders viel Zeit", "praxis"),
  "bei jeder Behandlung besonders viel Zeit",
);
assert.equal(
  applyClientAudienceToText("bei jedem einzelnen Auftrag besonders viel Zeit", "praxis"),
  "bei jeder einzelnen Behandlung besonders viel Zeit",
);
assert.equal(
  applyClientAudienceToText("während eines Behandlungs", "praxis"),
  "während einer Behandlung",
);
assert.equal(
  applyClientAudienceToText(
    "Mit welchen Kundentypen oder Aufträgen wird lieber nicht zusammengearbeitet?",
    "praxis",
  ),
  "Mit welchen Patiententypen oder Behandlungen wird lieber nicht zusammengearbeitet?",
);
assert.equal(
  applyClientAudienceToText("bei neuen Projekten", "praxis"),
  "bei neuen Behandlungen",
);
assert.match(
  applyClientAudienceToText("Individuelle Fragen für dieses Unternehmen", "praxis", {
    replaceBusiness: true,
  }),
  /diese Praxis/,
);
assert.equal(/Unternehmen/.test(
  applyClientAudienceToText("Individuelle Fragen für dieses Unternehmen", "praxis", {
    replaceBusiness: true,
  }),
), false);

const minOrder = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "min_order_value");
assert.ok(minOrder);
const praxisMin = customizeCoreQuestion({ template: minOrder, audience: "praxis" });
assert.match(praxisMin.title, /Behandlungswert/);
assert.match(praxisMin.title, /eine Behandlung/);
assert.match(praxisMin.title, /nicht rechnen/);
assert.equal(/zu klein/.test(praxisMin.title), false);
assert.equal(/Mandat|Auftrag(?!geber)/.test(praxisMin.title), false);

const unexpected = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "unexpected_challenges");
assert.ok(unexpected);
const praxisUnexpected = customizeCoreQuestion({ template: unexpected, audience: "praxis" });
assert.match(praxisUnexpected.title, /einer Behandlung/);
assert.equal(/eines Behandlung/.test(praxisUnexpected.title), false);
assert.equal(/Behandlungs/.test(praxisUnexpected.title), false);

const archetype = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "company_archetype");
assert.ok(archetype);
const praxisArch = customizeCoreQuestion({ template: archetype, audience: "praxis" });
assert.match(praxisArch.title, /zur Praxis/);
assert.equal(/Unternehmen/.test(praxisArch.title), false);

const usp = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "usp");
assert.ok(usp);
const praxisUsp = customizeCoreQuestion({ template: usp, audience: "praxis" });
assert.equal(
  /Arbeitnehmer|Spatenstich|Rechtsanwalt/.test(`${praxisUsp.title} ${praxisUsp.description}`),
  false,
);

const noFit = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "no_fit_clients");
assert.ok(noFit);
const praxisNoFit = customizeCoreQuestion({ template: noFit, audience: "praxis" });
assert.match(praxisNoFit.title, /Patiententypen oder Behandlungen/);
assert.equal(/Auftrag/.test(praxisNoFit.title), false);

const volume = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "volume_vs_depth");
assert.ok(volume);
const praxisVolume = customizeCoreQuestion({ template: volume, audience: "praxis" });
assert.match(praxisVolume.title, /jeder Behandlung/);
assert.equal(/jedem Behandlung/.test(praxisVolume.title), false);

const personaHold = PERSONA_CORE_QUESTIONS.find((q) => q.key === "persona_hold_back");
assert.ok(personaHold);
const holdKanzlei = customizeCoreQuestion({
  template: personaHold,
  audience: "kanzlei",
});
assert.match(holdKanzlei.title, /Mandant/);
assert.equal(/Kunde/.test(holdKanzlei.title), false);

const personaContact = PERSONA_CORE_QUESTIONS.find((q) => q.key === "persona_contact_is_client");
assert.ok(personaContact);
const praxisContact = customizeCoreQuestion({ template: personaContact, audience: "praxis" });
assert.equal(/Auftraggeber/.test(praxisContact.title), false);
assert.match(praxisContact.title, /entscheidet und bezahlt/);

console.log("client-audience: ok");
