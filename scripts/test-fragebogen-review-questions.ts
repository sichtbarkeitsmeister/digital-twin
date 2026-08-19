import assert from "node:assert/strict";

import {
  applyReviewQuestionType,
  buildSurveyAndAnswersFromReview,
  createEmptyExtraQuestion,
  reviewQuestionToSurveyField,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
} from "../lib/surveys/fragebogen-review-draft";

function baseDraft(questions: ReviewQuestionItem[]): FragebogenReviewDraft {
  return {
    title: "Persona: Test",
    description: "Testfragebogen",
    purpose: "persona",
    extraPlacement: "end",
    crawlPageCount: 0,
    websiteUrl: null,
    organisationName: "Test GmbH",
    questions,
  };
}

function coreQuestion(patch: Partial<ReviewQuestionItem> = {}): ReviewQuestionItem {
  return {
    id: "core_persona_name",
    kind: "core",
    coreKey: "persona_name",
    title: "Wie heißt der digitale Kunden-Avatar?",
    description: "Vorname / Kurzname.",
    included: true,
    required: true,
    type: "text",
    options: [],
    answer: "Max Mustermann",
    answerSource: "meeting",
    answerNote: "Aus Gespräch",
    ...patch,
  };
}

const extraText = createEmptyExtraQuestion();
assert.equal(extraText.kind, "extra");
assert.equal(extraText.type, "text");
assert.equal(extraText.required, false);
assert.equal(extraText.title, "");

const extraRadio = applyReviewQuestionType(
  { ...createEmptyExtraQuestion(), title: "Welches Budget passt typischerweise?" },
  "radio",
);
assert.equal(extraRadio.type, "radio");
assert.ok(extraRadio.options.length >= 1);
extraRadio.options[0]!.label = "unter 1.000 €";
extraRadio.options.push({ id: "opt_b", label: "über 1.000 €" });
extraRadio.required = true;
extraRadio.allowOtherOption = true;

const extraCheckbox = applyReviewQuestionType(
  { ...createEmptyExtraQuestion(), title: "Welche Kanäle nutzen Sie?" },
  "checkbox",
);
assert.equal(extraCheckbox.type, "checkbox");
extraCheckbox.options = [
  { id: "c1", label: "Instagram" },
  { id: "c2", label: "LinkedIn" },
];

const field = reviewQuestionToSurveyField(extraRadio);
assert.equal(field.type, "radio");
assert.equal(field.required, true);
if (field.type === "radio") {
  assert.equal(field.allowOtherOption, true);
  assert.ok(field.options.some((o) => o.label === "unter 1.000 €"));
}

const built = buildSurveyAndAnswersFromReview({
  draft: baseDraft([coreQuestion(), extraRadio, extraCheckbox]),
  savePrefills: true,
});

assert.equal(built.definition.steps.length >= 2, true);
const extraStep = built.definition.steps.find((s) => s.id === "extra_individual");
assert.ok(extraStep);
assert.equal(extraStep!.fields.length, 2);
assert.equal(extraStep!.fields[0]?.type, "radio");
assert.equal(extraStep!.fields[0]?.required, true);
assert.equal(extraStep!.fields[1]?.type, "checkbox");
assert.equal(built.answers.core_persona_name, "Max Mustermann");

const ranking = applyReviewQuestionType(
  { ...createEmptyExtraQuestion(), title: "Bitte priorisieren" },
  "ranking",
);
assert.ok(ranking.options.length >= 2);
const rankingField = reviewQuestionToSurveyField(ranking);
assert.equal(rankingField.type, "ranking");

const anbieterArchetype: ReviewQuestionItem = {
  id: "core_company_archetype",
  kind: "core",
  coreKey: "company_archetype",
  title: "Welcher Unternehmens-Typ trifft am ehesten zu?",
  description: "",
  included: true,
  required: false,
  type: "ranking",
  options: [
    { id: "a1", label: "Der Experte" },
    { id: "a2", label: "Der Kümmerer" },
  ],
  allowCustomEntries: true,
  answer: "",
  answerSource: "none",
  answerNote: "",
};
const anbieterBuilt = buildSurveyAndAnswersFromReview({
  draft: {
    ...baseDraft([anbieterArchetype]),
    purpose: "anbieter",
    title: "Anbieter: Test",
  },
  savePrefills: false,
});
const archetypeStep = anbieterBuilt.definition.steps.find((s) =>
  s.fields.some((f) => f.id === "core_company_archetype"),
);
assert.ok(archetypeStep);
assert.equal(archetypeStep?.title, "Unternehmen & Positionierung");
assert.equal(archetypeStep?.fields[0]?.type, "ranking");

console.log("fragebogen-review-questions: all ok");
