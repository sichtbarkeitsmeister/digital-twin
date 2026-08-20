/**
 * Core question templates for org Fragebogen wizard.
 * Run: npx tsx scripts/test-core-question-templates.ts
 */
import assert from "node:assert/strict";

import {
  ANBIETER_CORE_QUESTIONS,
  ANBIETER_INFO_TEXT,
  INTERN_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
  PERSONA_INFO_TEXT,
  buildCoreFields,
  coreQuestionsForPurpose,
  fieldFromCoreTemplate,
  fieldIdForCoreKey,
  surveyInfoTextForPurpose,
} from "../lib/surveys/core-question-templates";
import { surveyFromReview } from "../lib/surveys/fragebogen-review-draft";
import { surveySchema } from "../lib/surveys/schema";

assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "company_name"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "respondent_name"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "respondent_is_client"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "elevator_pitch"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "portfolio" && q.type === "checkbox"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "company_archetype" && q.type === "ranking"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "address_form" && q.type === "radio"));
assert.equal(
  ANBIETER_CORE_QUESTIONS.filter((q) => q.key === "website" || q.key === "employee_count").length,
  0,
);
assert.ok(
  ANBIETER_CORE_QUESTIONS.some(
    (q) => q.key === "typical_process" && q.type === "text_list" && (q.options?.length ?? 0) === 3,
  ),
);
assert.ok(
  ANBIETER_CORE_QUESTIONS.some(
    (q) => q.key === "competitors_top" && q.type === "text_list" && q.addEntryLabel === "Mitbewerber hinzufügen",
  ),
);
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "keyword_offer" && q.type === "text_list"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "keyword_problem" && q.type === "text_list"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "keyword_place" && q.type === "text_list"));
assert.equal(
  ANBIETER_CORE_QUESTIONS.filter(
    (q) =>
      q.key === "nap_consistency" ||
      q.key === "focus_keywords" ||
      q.key === "confirm_real_experience" ||
      q.key === "hormozi_dream" ||
      q.key === "company_voice" ||
      q.key === "jargon_level" ||
      q.key === "text_length" ||
      q.key === "portfolio_links" ||
      q.key === "actual_client_visibility" ||
      q.key === "external_mentions" ||
      q.key === "automation_goals" ||
      q.key === "public_use_permission" ||
      q.key === "image_assets",
  ).length,
  0,
);
assert.match(
  ANBIETER_CORE_QUESTIONS.find((q) => q.key === "usp")?.title ?? "",
  /andere nicht können/,
);
assert.match(
  ANBIETER_CORE_QUESTIONS.find((q) => q.key === "respondent_is_client")?.title ?? "",
  /Auftraggeber/,
);
assert.equal(
  /Auftraggeberin/.test(
    ANBIETER_CORE_QUESTIONS.find((q) => q.key === "respondent_is_client")?.title ?? "",
  ),
  false,
);

assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_pain"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_name" && q.type === "text"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_age" && q.type === "radio"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_job" && q.type === "ranking"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_hormozi_dream"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_summary"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_contact_is_client" && q.type === "radio"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_contact_other" && q.type === "text"));
assert.ok(
  PERSONA_CORE_QUESTIONS.some(
    (q) =>
      q.key === "persona_first_contact_phrases" &&
      q.type === "text_list" &&
      (q.options?.length ?? 0) === 5,
  ),
);
assert.ok(
  PERSONA_CORE_QUESTIONS.some(
    (q) => q.key === "persona_first_meeting_questions" && q.type === "text_list" && (q.options?.length ?? 0) === 3,
  ),
);
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_jargon_known" && q.type === "text_list"));
assert.ok(
  PERSONA_CORE_QUESTIONS.some(
    (q) =>
      q.key === "persona_journey_steps" &&
      /ungefähre Dauer/.test(q.title),
  ),
);
assert.equal(
  PERSONA_CORE_QUESTIONS.filter(
    (q) =>
      q.key === "persona_goal" ||
      q.key === "persona_criteria" ||
      q.key === "persona_confirm_real_experience" ||
      q.key === "persona_customer_groups" ||
      q.key === "persona_journey_duration" ||
      q.key === "persona_hormozi_trigger",
  ).length,
  0,
);

assert.equal(coreQuestionsForPurpose("anbieter"), ANBIETER_CORE_QUESTIONS);
assert.equal(coreQuestionsForPurpose("persona"), PERSONA_CORE_QUESTIONS);
assert.equal(coreQuestionsForPurpose("intern"), INTERN_CORE_QUESTIONS);
assert.ok(INTERN_CORE_QUESTIONS.some((q) => q.key === "nap_consistency" && q.type === "radio"));
assert.ok(INTERN_CORE_QUESTIONS.some((q) => q.key === "gbp_link" && q.type === "text"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "proven_metrics" && q.prefillHint === "seo_metrics"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "team_members" && q.prefillHint === "team_members"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_description" && q.prefillHint === "target_group"));
assert.ok(INTERN_CORE_QUESTIONS.some((q) => q.key === "gbp_hours" && q.prefillHint === "opening_hours"));
assert.ok(
  INTERN_CORE_QUESTIONS.some(
    (q) => q.key === "review_platforms" && q.type === "text_list" && (q.options?.length ?? 0) === 3,
  ),
);

const anbieterInfo = surveyInfoTextForPurpose("anbieter");
assert.equal(anbieterInfo.infoTextEnabled, true);
assert.match(anbieterInfo.infoText, /echten Erfahrungen/);
assert.equal(anbieterInfo.infoText, ANBIETER_INFO_TEXT);
const personaInfo = surveyInfoTextForPurpose("persona");
assert.equal(personaInfo.infoTextEnabled, true);
assert.match(personaInfo.infoText, /idealen Kunden/);
assert.equal(personaInfo.infoText, PERSONA_INFO_TEXT);
assert.equal(surveyInfoTextForPurpose("intern").infoTextEnabled, false);

const { steps, fieldIdsByKey } = buildCoreFields(ANBIETER_CORE_QUESTIONS);
assert.ok(steps.length >= 8);
assert.equal(steps[0]?.id, "core_intro");
assert.equal(steps.at(-1)?.id, "core_closing");
assert.equal(fieldIdsByKey.company_name, fieldIdForCoreKey("company_name"));
assert.equal(
  steps.some((s) => s.id === "core_hormozi"),
  false,
);

const personaBuilt = buildCoreFields(PERSONA_CORE_QUESTIONS);
assert.ok(personaBuilt.steps.length >= 11);
assert.equal(personaBuilt.steps[0]?.id, "core_persona_avatar");
assert.equal(personaBuilt.steps.at(-1)?.id, "core_persona_close");
assert.equal(personaBuilt.fieldIdsByKey.persona_name, fieldIdForCoreKey("persona_name"));
assert.equal(
  personaBuilt.steps.some((s) => s.id === "core_persona_intro"),
  false,
);

const ranking = fieldFromCoreTemplate(
  ANBIETER_CORE_QUESTIONS.find((q) => q.key === "company_archetype")!,
);
assert.equal(ranking.type, "ranking");
if (ranking.type === "ranking") {
  assert.ok(ranking.options.length >= 2);
  assert.equal(ranking.allowCustomEntries, false);
}

const definition = {
  version: 1 as const,
  id: "test-survey",
  title: "Test",
  description: "",
  infoTextEnabled: false,
  infoText: "",
  answerPlaceholder: "Deine Antwort…",
  steps,
};
const parsed = surveySchema.safeParse(definition);
assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues[0]?.message);

const keys = new Set(ANBIETER_CORE_QUESTIONS.map((q) => q.key));
assert.equal(keys.size, ANBIETER_CORE_QUESTIONS.length);

const personaKeys = new Set(PERSONA_CORE_QUESTIONS.map((q) => q.key));
assert.equal(personaKeys.size, PERSONA_CORE_QUESTIONS.length);

const personaDefinition = {
  version: 1 as const,
  id: "test-persona-survey",
  title: "Persona Test",
  description: "",
  infoTextEnabled: false,
  infoText: "",
  answerPlaceholder: "Deine Antwort…",
  steps: personaBuilt.steps,
};
const personaParsed = surveySchema.safeParse(personaDefinition);
assert.equal(
  personaParsed.success,
  true,
  personaParsed.success ? "" : personaParsed.error.issues[0]?.message,
);

const responseChannels = ANBIETER_CORE_QUESTIONS.find((q) => q.key === "response_channels");
assert.ok(responseChannels);
assert.match(responseChannels.title, /reagiert/);

const processField = fieldFromCoreTemplate(
  ANBIETER_CORE_QUESTIONS.find((q) => q.key === "typical_process")!,
);
assert.equal(processField.type, "text_list");
if (processField.type === "text_list") {
  assert.equal(processField.options.length, 3);
  assert.equal(processField.allowExtraEntries, true);
  assert.equal(processField.addEntryLabel, "Schritt hinzufügen");
}

const internBuilt = buildCoreFields(INTERN_CORE_QUESTIONS);
assert.equal(internBuilt.steps[0]?.id, "core_intern_intro");
assert.equal(internBuilt.steps.at(-1)?.id, "core_intern_gbp");
const internDefinition = {
  version: 1 as const,
  id: "test-intern-survey",
  title: "Intern Test",
  description: "",
  infoTextEnabled: true,
  infoText: "Intern",
  answerPlaceholder: "Deine Antwort…",
  steps: internBuilt.steps,
};
const internParsed = surveySchema.safeParse(internDefinition);
assert.equal(
  internParsed.success,
  true,
  internParsed.success ? "" : internParsed.error.issues[0]?.message,
);
const internKeys = new Set(INTERN_CORE_QUESTIONS.map((q) => q.key));
assert.equal(internKeys.size, INTERN_CORE_QUESTIONS.length);

const reviewSurvey = surveyFromReview({
  title: "Anbieter: Test",
  description: "Test",
  purpose: "anbieter",
  extraPlacement: "end",
  crawlPageCount: 0,
  websiteUrl: null,
  organisationName: "Test GmbH",
  questions: [
    {
      id: "core_company_name",
      kind: "core",
      coreKey: "company_name",
      title: "Wie lautet der vollständige Name der Firma?",
      description: "",
      included: true,
      required: true,
      type: "text",
      options: [],
      answer: "",
      answerSource: "none",
      answerNote: "",
    },
  ],
});
assert.equal(reviewSurvey.infoTextEnabled, true);
assert.match(reviewSurvey.infoText ?? "", /echten Erfahrungen/);

console.log("core-question-templates: ok");
