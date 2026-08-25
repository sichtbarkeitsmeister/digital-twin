/**
 * Generated choice fields always allow custom options; checkbox suggestions are editable.
 * Run: npx tsx scripts/test-choice-custom-options.ts
 */
import assert from "node:assert/strict";

import { generatedChoiceCustomOptionFlags } from "../lib/surveys/choice-custom-options";
import {
  ANBIETER_CORE_QUESTIONS,
  fieldFromCoreTemplate,
} from "../lib/surveys/core-question-templates";
import { mergeSuggestedCheckboxOptions } from "../lib/surveys/customize-fragebogen";
import { normalizeSurveyAnswer } from "../lib/dt/survey-to-agent-context";
import {
  applyReviewQuestionType,
  buildSurveyAndAnswersFromReview,
  createEmptyExtraQuestion,
  reviewQuestionToSurveyField,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
} from "../lib/surveys/fragebogen-review-draft";
import {
  CHECKBOX_EDIT_PREFIX,
  decodeOtherValueForDisplay,
  displayedCheckboxPresetLabel,
  parseCheckboxOtherEntries,
  setCheckboxPresetLabel,
  setCheckboxPresetSelection,
} from "../lib/surveys/other-option";
import type { SurveyField } from "../lib/surveys/types";

assert.deepEqual(generatedChoiceCustomOptionFlags("radio"), { allowOtherOption: true });
assert.deepEqual(generatedChoiceCustomOptionFlags("checkbox"), { allowOtherOption: true });
assert.deepEqual(generatedChoiceCustomOptionFlags("ranking"), { allowCustomEntries: true });
assert.deepEqual(generatedChoiceCustomOptionFlags("text_list"), { allowExtraEntries: true });
assert.deepEqual(generatedChoiceCustomOptionFlags("text"), {});
assert.deepEqual(generatedChoiceCustomOptionFlags("rating"), {});

const radio = fieldFromCoreTemplate(ANBIETER_CORE_QUESTIONS.find((q) => q.key === "address_form")!);
assert.equal(radio.type, "radio");
if (radio.type === "radio") assert.equal(radio.allowOtherOption, true);

const portfolio = fieldFromCoreTemplate(ANBIETER_CORE_QUESTIONS.find((q) => q.key === "portfolio")!);
assert.equal(portfolio.type, "checkbox");
if (portfolio.type === "checkbox") assert.equal(portfolio.allowOtherOption, true);

const extraRadio = applyReviewQuestionType(
  { ...createEmptyExtraQuestion(), title: "Du oder Sie?" },
  "radio",
);
assert.equal(extraRadio.allowOtherOption, true);
const extraRadioField = reviewQuestionToSurveyField(extraRadio);
assert.equal(extraRadioField.type, "radio");
if (extraRadioField.type === "radio") assert.equal(extraRadioField.allowOtherOption, true);

const placeholders = [
  { id: "portfolio_1", label: "[Leistung 1 – vor Versand passend zur Branche ersetzen]" },
  { id: "portfolio_2", label: "[Leistung 2 – vor Versand passend zur Branche ersetzen]" },
];
const merged = mergeSuggestedCheckboxOptions(
  placeholders,
  "Arbeitsrecht\nFamilienrecht",
);
assert.deepEqual(
  merged.map((opt) => opt.label),
  ["Arbeitsrecht", "Familienrecht"],
);

const appended = mergeSuggestedCheckboxOptions(
  [
    { id: "portfolio_1", label: "Arbeitsrecht" },
    { id: "portfolio_2", label: "Familienrecht" },
  ],
  "Arbeitsrecht\nInsolvenzrecht",
);
assert.ok(appended.some((opt) => opt.label === "Arbeitsrecht"));
assert.ok(appended.some((opt) => opt.label === "Familienrecht"));
assert.ok(appended.some((opt) => opt.label === "Insolvenzrecht"));

const presetLabels = ["SEO", "SEA"];
let answer: unknown = ["SEO"];
answer = setCheckboxPresetLabel(answer, presetLabels, "SEO", "SEO & Content");
const editedState = parseCheckboxOtherEntries(answer, presetLabels);
assert.equal(editedState.selectedPresets.has("SEO"), true);
assert.equal(displayedCheckboxPresetLabel("SEO", editedState), "SEO & Content");
assert.equal(Array.isArray(answer) && answer.some((entry) => typeof entry === "string" && entry.startsWith(CHECKBOX_EDIT_PREFIX)), true);
assert.equal(decodeOtherValueForDisplay((answer as string[])[0]!), "SEO & Content");

const checkboxField: SurveyField = {
  id: "core_portfolio",
  type: "checkbox",
  title: "Leistungen",
  description: "",
  required: true,
  options: [
    { id: "p1", label: "SEO" },
    { id: "p2", label: "SEA" },
  ],
  allowOtherOption: true,
};
assert.equal(normalizeSurveyAnswer(answer, checkboxField), "SEO & Content");

answer = setCheckboxPresetSelection(answer, presetLabels, "SEO", false);
const unchecked = parseCheckboxOtherEntries(answer, presetLabels);
assert.equal(unchecked.selectedPresets.has("SEO"), false);

function baseDraft(questions: ReviewQuestionItem[]): FragebogenReviewDraft {
  return {
    title: "Anbieter: Leistungen",
    description: "Test",
    purpose: "anbieter",
    extraPlacement: "end",
    crawlPageCount: 0,
    websiteUrl: null,
    organisationName: "Test GmbH",
    questions,
  };
}

const portfolioPrefill: ReviewQuestionItem = {
  id: "core_portfolio",
  kind: "core",
  coreKey: "portfolio",
  title: "Welche Leistungen?",
  description: "",
  included: true,
  required: true,
  type: "checkbox",
  options: [
    { id: "portfolio_1", label: "Arbeitsrecht" },
    { id: "portfolio_2", label: "Familienrecht" },
  ],
  answer: "Arbeitsrecht\nInsolvenzrecht",
  answerSource: "crawl",
  answerNote: "Aus Crawl",
};
const built = buildSurveyAndAnswersFromReview({
  draft: baseDraft([portfolioPrefill]),
  savePrefills: true,
});
const rawAnswer = built.answers.core_portfolio;
assert.ok(Array.isArray(rawAnswer));
const parsedPrefill = parseCheckboxOtherEntries(rawAnswer, ["Arbeitsrecht", "Familienrecht"]);
assert.equal(parsedPrefill.selectedPresets.has("Arbeitsrecht"), true);
assert.equal(parsedPrefill.otherEntries.some((entry) => entry.text === "Insolvenzrecht"), true);
const portfolioField = built.definition.steps
  .flatMap((step) => step.fields)
  .find((field) => field.id === "core_portfolio");
assert.equal(portfolioField?.type, "checkbox");
if (portfolioField?.type === "checkbox") {
  assert.equal(portfolioField.allowOtherOption, true);
}

console.log("test-choice-custom-options: ok");
