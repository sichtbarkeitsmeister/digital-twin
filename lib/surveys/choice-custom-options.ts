import type { SurveyField, SurveyFieldType } from "@/lib/surveys/types";

/**
 * Generated questionnaires always let respondents add their own choices
 * on every structured field except free text and rating scales.
 */
export function generatedChoiceCustomOptionFlags(type: SurveyFieldType): {
  allowOtherOption?: boolean;
  allowCustomEntries?: boolean;
  allowExtraEntries?: boolean;
} {
  if (type === "radio" || type === "checkbox") return { allowOtherOption: true };
  if (type === "ranking") return { allowCustomEntries: true };
  if (type === "text_list") return { allowExtraEntries: true };
  return {};
}

export function withGeneratedChoiceCustomOptions<T extends SurveyField>(field: T): T {
  const flags = generatedChoiceCustomOptionFlags(field.type);
  if (Object.keys(flags).length === 0) return field;
  return { ...field, ...flags };
}
