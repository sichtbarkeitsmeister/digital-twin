/**
 * Core question templates for org Fragebogen wizard.
 * Run: npx tsx scripts/test-core-question-templates.ts
 */
import assert from "node:assert/strict";

import {
  ANBIETER_CORE_QUESTIONS,
  PERSONA_CORE_QUESTIONS,
  buildCoreFields,
  coreQuestionsForPurpose,
  fieldFromCoreTemplate,
  fieldIdForCoreKey,
} from "../lib/surveys/core-question-templates";
import { surveySchema } from "../lib/surveys/schema";

assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "company_name"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "confirm_real_experience"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "hormozi_dream"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "elevator_pitch"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "portfolio" && q.type === "checkbox"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "company_archetype" && q.type === "ranking"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "address_form" && q.type === "radio"));
assert.equal(
  ANBIETER_CORE_QUESTIONS.filter((q) => q.key === "website" || q.key === "employee_count").length,
  0,
);
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_pain"));

assert.equal(coreQuestionsForPurpose("anbieter"), ANBIETER_CORE_QUESTIONS);
assert.equal(coreQuestionsForPurpose("persona"), PERSONA_CORE_QUESTIONS);

const { steps, fieldIdsByKey } = buildCoreFields(ANBIETER_CORE_QUESTIONS);
assert.ok(steps.length >= 8);
assert.equal(steps[0]?.id, "core_intro");
assert.equal(steps.at(-1)?.id, "core_closing");
assert.equal(fieldIdsByKey.company_name, fieldIdForCoreKey("company_name"));

const ranking = fieldFromCoreTemplate(
  ANBIETER_CORE_QUESTIONS.find((q) => q.key === "company_archetype")!,
);
assert.equal(ranking.type, "ranking");
if (ranking.type === "ranking") {
  assert.ok(ranking.options.length >= 2);
  assert.equal(ranking.allowCustomEntries, true);
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

console.log("core-question-templates: ok");
