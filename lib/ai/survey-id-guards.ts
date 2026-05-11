import { surveySchema } from "@/lib/surveys/schema";

export function validateUniqueSurveyIds(input: unknown) {
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Ungültige Umfrage." };
  }

  const survey = parsed.data;
  const stepIds = new Set<string>();
  const fieldIds = new Set<string>();

  for (const step of survey.steps) {
    if (stepIds.has(step.id)) {
      return { ok: false as const, message: `Doppelte Schritt-ID erkannt: ${step.id}` };
    }
    stepIds.add(step.id);

    for (const field of step.fields) {
      if (fieldIds.has(field.id)) {
        return { ok: false as const, message: `Doppelte Feld-ID erkannt: ${field.id}` };
      }
      fieldIds.add(field.id);

      if ("options" in field && Array.isArray(field.options)) {
        const optionIds = new Set<string>();
        for (const option of field.options) {
          if (optionIds.has(option.id)) {
            return {
              ok: false as const,
              message: `Doppelte Options-ID im Feld "${field.title}" erkannt: ${option.id}`,
            };
          }
          optionIds.add(option.id);
        }
      }
    }
  }

  return { ok: true as const };
}

