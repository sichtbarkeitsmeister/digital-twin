import { surveySchema } from "@/lib/surveys/schema";

export function getFieldMetaFromSurveyDefinition(
  definition: unknown,
  fieldId: string,
): { title: string; description: string } | null {
  const parsed = surveySchema.safeParse(definition);
  if (!parsed.success) return null;

  for (const step of parsed.data.steps) {
    for (const field of step.fields) {
      if (field.id === fieldId) {
        return { title: field.title ?? "", description: field.description ?? "" };
      }
    }
  }

  return null;
}

