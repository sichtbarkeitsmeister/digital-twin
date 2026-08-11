import {
  checkSurveyFactsCoverage,
  extractSurveyFacts,
  formatSurveyFactsForAgentContext,
  summarizeSurveyFactCoverage,
  type SurveyFact,
  type SurveyFactCoverageSummary,
} from "@/lib/dt/survey-facts";
import type { SurveyFieldQuestionRow } from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export type AgentSurveyFactsBundle = {
  surveyId: string;
  responseId: string;
  surveyTitle: string;
  facts: SurveyFact[];
  /** Full checklist + details for the Survey KI assistant. */
  factsChecklist: string;
};

/**
 * Load filled questionnaire answers for a survey response (service role).
 * Used by Survey KI context and agent prompt coverage checks.
 */
export async function loadAgentSurveyFactsBundle(
  surveyId: string,
  responseId: string,
): Promise<
  | { ok: true; bundle: AgentSurveyFactsBundle }
  | { ok: false; status: number; message: string }
> {
  const supabase = createServiceClient();

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, definition")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) {
    return { ok: false, status: 404, message: "Umfrage nicht gefunden." };
  }

  const { data: response } = await supabase
    .from("survey_responses")
    .select("id, status, answers")
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (!response) {
    return { ok: false, status: 404, message: "Antwort nicht gefunden." };
  }

  if (response.status !== "completed") {
    return {
      ok: false,
      status: 400,
      message: "Nur abgeschlossene Antworten können abgeglichen werden.",
    };
  }

  const { data: questionsRows } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  const extracted = extractSurveyFacts({
    surveyTitle: survey.title,
    definition: survey.definition,
    answers: isRecord(response.answers) ? response.answers : {},
    fieldQuestions: (questionsRows ?? []) as SurveyFieldQuestionRow[],
  });

  return {
    ok: true,
    bundle: {
      surveyId,
      responseId,
      surveyTitle: extracted.surveyTitle,
      facts: extracted.facts,
      factsChecklist: formatSurveyFactsForAgentContext(extracted),
    },
  };
}

/** Compare current DigitalTwin prompt texts against questionnaire facts. */
export function comparePromptToSurveyFacts(input: {
  facts: SurveyFact[];
  promptTemplate: string;
  promptAppend?: string | null;
}): SurveyFactCoverageSummary {
  const texts = [input.promptTemplate, input.promptAppend ?? ""].filter((t) =>
    t.trim(),
  );
  const report = checkSurveyFactsCoverage({ facts: input.facts, texts });
  return summarizeSurveyFactCoverage({ facts: input.facts, report });
}
