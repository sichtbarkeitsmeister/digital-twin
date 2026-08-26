import { surveySchema, type SurveyParsed } from "@/lib/surveys/schema";

export type ParsedImportedSurvey = {
  definition: SurveyParsed;
  title: string;
  description: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function tryDefinition(raw: unknown): SurveyParsed | null {
  const parsed = surveySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Accepts a bare survey definition, `{ definition }`, or an export bundle
 * `{ version, survey: { title, description, definition } }`.
 */
export function parseImportedSurveyJson(
  raw: unknown,
): { ok: true; data: ParsedImportedSurvey } | { ok: false; error: string } {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, error: "Ungültiges JSON." };

  const surveyRec = asRecord(rec.survey);
  const candidates: unknown[] = [
    rec.definition,
    surveyRec?.definition,
    surveyRec,
    raw,
  ];

  for (const candidate of candidates) {
    const definition = tryDefinition(candidate);
    if (!definition) continue;
    const title =
      (typeof surveyRec?.title === "string" && surveyRec.title.trim()) || definition.title;
    const description =
      typeof surveyRec?.description === "string"
        ? surveyRec.description
        : definition.description;
    return { ok: true, data: { definition, title, description } };
  }

  const firstIssue = surveySchema.safeParse(raw);
  return {
    ok: false,
    error: firstIssue.success
      ? "Ungültige Umfrage-Definition."
      : (firstIssue.error.issues[0]?.message ?? "Ungültige Umfrage-Definition."),
  };
}

/** Keep the existing survey identity and list title; take steps/fields from JSON. */
export function definitionForExistingSurvey(input: {
  existingDefinitionId: string;
  existingTitle: string;
  existingDescription: string;
  imported: SurveyParsed;
}): SurveyParsed {
  return {
    ...input.imported,
    id: input.existingDefinitionId || input.imported.id,
    title: input.existingTitle || input.imported.title,
    description: input.existingDescription || input.imported.description,
  };
}
