/**
 * Agent prompt vs questionnaire coverage helpers.
 * Run: npx tsx scripts/test-agent-survey-coverage.ts
 */
import assert from "node:assert/strict";

import { comparePromptToSurveyFacts } from "../lib/dt/agent-survey-coverage";
import {
  formatCoverageOptionLabel,
  pickDefaultCoverageOption,
  suggestCoverageOptionForAgent,
  type AgentCoverageSurveyOption,
} from "../lib/dt/agent-survey-coverage-option-helpers";
import { pickBestSurveyResponseForCoverage, matchSurveyFoldersToOrganisationName, organisationLabelMatches, pickPreferredSurveyFolder } from "../lib/dt/agent-survey-coverage-options";
import type { SurveyFact } from "../lib/dt/survey-facts";

const facts: SurveyFact[] = [
  {
    id: "fact_001",
    fieldId: "f1",
    fieldTitle: "Alter",
    fieldType: "text",
    fieldDescription: null,
    stepTitle: "Profil",
    kind: "answer",
    label: "Alter",
    value: "45–55 Jahre",
  },
  {
    id: "fact_002",
    fieldId: "f2",
    fieldTitle: "Prioritäten",
    fieldType: "ranking",
    fieldDescription: null,
    stepTitle: "Profil",
    kind: "answer",
    label: "Prioritäten",
    value: "Rangfolge (1 = höchste Priorität):\n1. Qualität\n2. Preis",
  },
];

const covered = comparePromptToSurveyFacts({
  facts,
  promptTemplate:
    "Du bist Heike, 45–55 Jahre alt. Deine Prioritäten: Rangfolge (1 = höchste Priorität): 1. Qualität 2. Preis.",
  promptAppend: null,
});
assert.ok(covered.coveredCount >= 1);
assert.ok(covered.missingCount <= 1);

const missing = comparePromptToSurveyFacts({
  facts,
  promptTemplate: "Du bist eine Persona ohne konkrete Angaben.",
  promptAppend: null,
});
assert.ok(missing.missingCount >= 1);
assert.ok(
  missing.missing.some((m) => /45–55|Qualität/i.test(m.valueText)),
);

const options: AgentCoverageSurveyOption[] = [
  {
    surveyId: "s2",
    responseId: "r2",
    surveyTitle: "Neuere Persona",
    purpose: "persona",
    completedAt: "2026-08-10T12:00:00.000Z",
    isSource: false,
  },
  {
    surveyId: "s1",
    responseId: "r1",
    surveyTitle: "Herkunfts-Umfrage",
    purpose: "persona",
    completedAt: "2026-01-01T12:00:00.000Z",
    isSource: true,
  },
];

assert.equal(pickDefaultCoverageOption(options)?.responseId, "r1");
assert.equal(pickDefaultCoverageOption(options.slice(0, 1))?.responseId, "r2");
assert.equal(pickDefaultCoverageOption([]), null);

const label = formatCoverageOptionLabel(options[1]!);
assert.match(label, /Herkunfts-Umfrage/);
assert.match(label, /Herkunft/);

const unmarked: AgentCoverageSurveyOption[] = [
  {
    surveyId: "s-fam",
    responseId: "r-fam",
    surveyTitle: "Kunden-Persona – Die Prophylaxe-Familie",
    purpose: "persona",
    completedAt: "2026-07-02T12:00:00.000Z",
    isSource: false,
  },
  {
    surveyId: "s-markus",
    responseId: "r-markus",
    surveyTitle: "Kunden-Persona – Markus Ohlig",
    purpose: "persona",
    completedAt: "2026-06-01T12:00:00.000Z",
    isSource: false,
  },
];

assert.equal(
  suggestCoverageOptionForAgent(unmarked, "Markus Ohlig")?.responseId,
  "r-markus",
);
assert.equal(
  suggestCoverageOptionForAgent(
    unmarked.map((o, i) => ({ ...o, isSource: i === 0 })),
    "Markus Ohlig",
  )?.responseId,
  "r-fam",
);

const usedLabel = formatCoverageOptionLabel({
  ...unmarked[0]!,
  usedByOtherAgentName: "Nadine Müller",
});
assert.match(usedLabel, /Nadine Müller/);

const best = pickBestSurveyResponseForCoverage([
  {
    id: "r-old",
    status: "in_progress",
    completed_at: null,
    updated_at: "2026-08-01T12:00:00.000Z",
    answers: { a: 1 },
  },
  {
    id: "r-done",
    status: "completed",
    completed_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    answers: { a: 1 },
  },
]);
assert.equal(best?.id, "r-done");

const folders = [
  { id: "f1", name: "Zahnarztpraxis Ruth Hennes" },
  { id: "f2", name: "Kolb & Sartor" },
  { id: "f3", name: "Zahnarztpraxis Hennes" },
];
assert.deepEqual(
  matchSurveyFoldersToOrganisationName(folders, "Zahnarztpraxis Ruth Hennes").map(
    (f) => f.id,
  ),
  ["f1"],
);
assert.ok(
  matchSurveyFoldersToOrganisationName(
    [{ id: "f3", name: "Zahnarztpraxis Hennes" }],
    "Zahnarztpraxis Ruth Hennes",
  ).some((f) => f.id === "f3"),
);

const arcticFolders = [
  { id: "at-spaced", name: "Arctic Tub" },
  { id: "at-camel", name: "ArcticTub" },
  { id: "unrelated", name: "Kolb & Sartor" },
];
assert.deepEqual(
  matchSurveyFoldersToOrganisationName(arcticFolders, "arctictub").map((f) => f.id).sort(),
  ["at-camel", "at-spaced"],
  "slug-style org name must match spaced and camelCase folders",
);
assert.deepEqual(
  matchSurveyFoldersToOrganisationName(arcticFolders, "Arctic Tub", ["arctictub"]).map(
    (f) => f.id,
  ).sort(),
  ["at-camel", "at-spaced"],
);
assert.deepEqual(
  matchSurveyFoldersToOrganisationName(
    [{ id: "gmbh", name: "ArcticTub GmbH" }, { id: "other", name: "Allround" }],
    "arctictub",
    ["ArcticTub"],
  ).map((f) => f.id),
  ["gmbh"],
);

assert.equal(
  organisationLabelMatches("Anbieterfragebogen Arctic Tub", "arctictub"),
  true,
);
assert.equal(
  organisationLabelMatches("Persona Markus Ohlig", "arctictub", ["ArcticTub"]),
  false,
);
assert.equal(
  pickPreferredSurveyFolder(arcticFolders, ["ArcticTub", "arctictub"])?.id,
  "at-camel",
);

console.log("agent-survey-coverage tests: ok");
