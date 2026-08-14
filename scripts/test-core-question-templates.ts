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
  fieldIdForCoreKey,
} from "../lib/surveys/core-question-templates";
import { surveySchema } from "../lib/surveys/schema";

assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "company_name"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "employee_count"));
assert.ok(ANBIETER_CORE_QUESTIONS.some((q) => q.key === "focus"));
assert.ok(PERSONA_CORE_QUESTIONS.some((q) => q.key === "persona_pain"));

assert.equal(coreQuestionsForPurpose("anbieter"), ANBIETER_CORE_QUESTIONS);
assert.equal(coreQuestionsForPurpose("persona"), PERSONA_CORE_QUESTIONS);

const { steps, fieldIdsByKey } = buildCoreFields(ANBIETER_CORE_QUESTIONS);
assert.ok(steps.length >= 2);
assert.equal(fieldIdsByKey.company_name, fieldIdForCoreKey("company_name"));

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
assert.equal(surveySchema.safeParse(definition).success, true);

console.log("core-question-templates: ok");
