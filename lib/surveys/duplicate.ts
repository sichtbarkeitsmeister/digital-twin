import type { SurveyParsed } from "@/lib/surveys/schema";

/** Display title for a duplicated survey draft. */
export function buildDuplicatedSurveyTitle(title: string): string {
  const t = title.trim() || "Umfrage";
  return `Kopie von ${t}`;
}

/** Keep field/step ids (so answers still map), but give the definition a new identity. */
export function withNewSurveyDefinitionId(definition: SurveyParsed): SurveyParsed {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `survey_${Date.now()}`;
  return { ...definition, id };
}
