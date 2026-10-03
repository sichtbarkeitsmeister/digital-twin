import assert from "node:assert/strict";

import {
  applyReviewQuestionType,
  buildSurveyAndAnswersFromReview,
  createEmptyExtraQuestion,
  createSurveyDefinitionId,
  insertExtraStep,
  mergeSurveyIntoReviewDraft,
  reviewQuestionToSurveyField,
  surveyFromReview,
  type FragebogenReviewDraft,
  type ReviewQuestionItem,
} from "../lib/surveys/fragebogen-review-draft";
import type { SurveyStep } from "../lib/surveys/types";

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
    aiWarning: null,
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
assert.equal(extraText.required, true);
assert.equal(extraText.title, "");

const extraRadio = applyReviewQuestionType(
  { ...createEmptyExtraQuestion(), title: "Welches Budget passt typischerweise?" },
  "radio",
);
assert.equal(extraRadio.type, "radio");
assert.equal(extraRadio.allowOtherOption, true);
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
assert.equal(extraCheckbox.allowOtherOption, true);
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
    { id: "portfolio_3", label: "Mietrecht" },
  ],
  allowOtherOption: true,
  answer: "Arbeitsrecht\nFamilienrecht",
  answerSource: "crawl",
  answerNote: "Aus Crawl",
};
const portfolioBuilt = buildSurveyAndAnswersFromReview({
  draft: {
    ...baseDraft([portfolioPrefill]),
    purpose: "anbieter",
    title: "Anbieter: Leistungen",
  },
  savePrefills: true,
});
assert.deepEqual(portfolioBuilt.answers.core_portfolio, ["Arbeitsrecht", "Familienrecht"]);
assert.equal(portfolioBuilt.definition.steps[0]?.title, "Das Unternehmen");

const kanzleiName: ReviewQuestionItem = {
  id: "core_company_name",
  kind: "core",
  coreKey: "company_name",
  title: "Wie lautet der vollständige Name der Kanzlei?",
  description: "",
  included: true,
  required: true,
  type: "text",
  options: [],
  answer: "",
  answerSource: "none",
  answerNote: "",
};
const kanzleiBuilt = buildSurveyAndAnswersFromReview({
  draft: {
    ...baseDraft([kanzleiName]),
    purpose: "anbieter",
    title: "Anbieter: Kanzlei",
    clientAudience: "kanzlei",
  },
  savePrefills: false,
});
assert.equal(kanzleiBuilt.definition.steps[0]?.title, "Die Kanzlei");
assert.match(kanzleiBuilt.definition.infoText ?? "", /Mandant|echten Erfahrungen/);

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
assert.equal(archetypeStep?.title, "Das Unternehmen");
assert.equal(archetypeStep?.fields[0]?.type, "ranking");
assert.equal(anbieterBuilt.definition.infoTextEnabled, true);
assert.match(anbieterBuilt.definition.infoText ?? "", /echten Erfahrungen/);

const personaAge: ReviewQuestionItem = {
  id: "core_persona_age",
  kind: "core",
  coreKey: "persona_age",
  title: "In welchem Altersbereich befindet sich der Großteil der Wunschkundschaft?",
  description: "",
  included: true,
  required: false,
  type: "radio",
  options: [
    { id: "35_44", label: "35–44" },
    { id: "45_54", label: "45–54" },
  ],
  answer: "35_44",
  answerSource: "none",
  answerNote: "",
};
const personaBuilt = buildSurveyAndAnswersFromReview({
  draft: baseDraft([coreQuestion(), personaAge]),
  savePrefills: true,
});
const ageStep = personaBuilt.definition.steps.find((s) =>
  s.fields.some((f) => f.id === "core_persona_age"),
);
assert.ok(ageStep);
assert.equal(ageStep?.title, "Alter, Beruf & Lebenssituation");
assert.equal(ageStep?.fields.find((f) => f.id === "core_persona_age")?.type, "radio");

const teamList: ReviewQuestionItem = {
  id: "core_team_members",
  kind: "core",
  coreKey: "team_members",
  title: "Wer gehört zum Team?",
  description: "",
  included: true,
  required: false,
  type: "text_list",
  options: [
    { id: "team_1", label: "" },
    { id: "team_2", label: "" },
    { id: "team_3", label: "" },
  ],
  allowExtraEntries: true,
  answer: "Anna Müller, Inhaberin\nMax Schmidt, Beratung",
  answerSource: "crawl",
  answerNote: "Aus Crawl",
};
const teamBuilt = buildSurveyAndAnswersFromReview({
  draft: {
    ...baseDraft([teamList]),
    purpose: "anbieter",
    title: "Anbieter: Team",
  },
  savePrefills: true,
});
const teamAnswer = teamBuilt.answers.core_team_members as {
  entries?: Array<{ id: string; value: string }>;
};
assert.equal(teamAnswer?.entries?.[0]?.value, "Anna Müller, Inhaberin");
assert.equal(teamAnswer?.entries?.[1]?.value, "Max Schmidt, Beratung");

const withAiWarning = buildSurveyAndAnswersFromReview({
  draft: {
    ...baseDraft([coreQuestion()]),
    aiWarning:
      "KI-Vorausfüllung hat zu lange gedauert. Crawl- und Dateiangaben sind trotzdem übernommen — bitte prüfen.",
  },
  savePrefills: true,
});
assert.equal(withAiWarning.answers.core_persona_name, "Max Mustermann");

const definitionId = "11111111-1111-4111-8111-111111111111";
assert.match(createSurveyDefinitionId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const stableDraft = {
  ...baseDraft([coreQuestion()]),
  definitionId,
};
const fromStable = surveyFromReview(stableDraft);
assert.equal(fromStable.id, definitionId);
const merged = mergeSurveyIntoReviewDraft(stableDraft, {
  ...fromStable,
  title: "Persona: Gepatcht",
});
assert.equal(merged.title, "Persona: Gepatcht");
assert.equal(merged.definitionId, definitionId);
assert.equal(merged.questions[0]?.answer, "Max Mustermann");
assert.equal(merged.questions[0]?.coreKey, "persona_name");

const stubStep = (id: string): SurveyStep => ({
  id,
  title: id,
  description: "",
  fields: [{ id: `${id}_f`, type: "text", title: id, description: "", required: false }],
});
const extrasStub = stubStep("extra_individual");
assert.deepEqual(
  insertExtraStep([stubStep("core_intro"), stubStep("core_closing")], extrasStub, "end").map(
    (s) => s.id,
  ),
  ["core_intro", "extra_individual", "core_closing"],
);
assert.deepEqual(
  insertExtraStep([stubStep("core_intro"), stubStep("core_closing")], extrasStub, "start").map(
    (s) => s.id,
  ),
  ["extra_individual", "core_intro", "core_closing"],
);
assert.deepEqual(
  insertExtraStep([stubStep("core_intro")], extrasStub, "end").map((s) => s.id),
  ["core_intro", "extra_individual"],
);

function includedQuestion(
  patch: Partial<ReviewQuestionItem> & Pick<ReviewQuestionItem, "id" | "kind" | "title">,
): ReviewQuestionItem {
  return {
    description: "",
    included: true,
    required: true,
    type: "text",
    options: [],
    answer: "",
    answerSource: "none",
    answerNote: "",
    ...patch,
  };
}

const anbieterWithExtras = surveyFromReview({
  title: "Anbieter: Test",
  description: "Test",
  purpose: "anbieter",
  extraPlacement: "end",
  crawlPageCount: 0,
  websiteUrl: null,
  organisationName: "Test GmbH",
  questions: [
    includedQuestion({
      id: "core_company_name",
      kind: "core",
      coreKey: "company_name",
      title: "Name",
    }),
    includedQuestion({
      id: "core_anything_else",
      kind: "core",
      coreKey: "anything_else",
      title: "Sonstiges",
    }),
    includedQuestion({
      id: "extra_1",
      kind: "extra",
      title: "Individuelle Frage",
    }),
  ],
});
assert.deepEqual(anbieterWithExtras.steps.map((s) => s.id), [
  "core_company",
  "extra_individual",
  "core_closing",
]);

const personaWithExtras = surveyFromReview({
  ...baseDraft([
    coreQuestion(),
    includedQuestion({
      id: "core_persona_anything_else",
      kind: "core",
      coreKey: "persona_anything_else",
      title: "Sonstiges",
    }),
    includedQuestion({
      id: "extra_p",
      kind: "extra",
      title: "Individuelle Persona-Frage",
    }),
  ]),
});
assert.equal(personaWithExtras.steps.at(-1)?.id, "core_persona_close");
assert.equal(personaWithExtras.steps.at(-2)?.id, "extra_individual");

console.log("fragebogen-review-questions: all ok");
