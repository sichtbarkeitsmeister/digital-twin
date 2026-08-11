import { extractSurveyFacts } from "@/lib/dt/survey-facts";
import {
  buildSurveyExamQuestions,
  type SurveyExamQuestion,
} from "@/lib/dt/survey-exam-questions";
import { loadSurveyResponseBundle } from "@/lib/dt/survey-to-agent-service";

export type LoadSurveyExamQuestionsResult =
  | {
      ok: true;
      surveyTitle: string;
      factCount: number;
      questions: SurveyExamQuestion[];
    }
  | { ok: false; status: number; message: string };

/**
 * Deterministic interviewer script for a completed survey response.
 * Shared by survey preview and agent Persona-Testing.
 */
export async function loadSurveyExamQuestionsForResponse(
  surveyId: string,
  responseId: string,
): Promise<LoadSurveyExamQuestionsResult> {
  const bundle = await loadSurveyResponseBundle(surveyId, responseId);
  if (!bundle.ok) {
    return { ok: false, status: bundle.status, message: bundle.message };
  }

  const facts = extractSurveyFacts({
    surveyTitle: bundle.survey.title,
    definition: bundle.survey.definition,
    answers: (bundle.response.answers ?? {}) as Record<string, unknown>,
    fieldQuestions: bundle.fieldQuestions,
  });

  const questions = buildSurveyExamQuestions(facts.facts);

  return {
    ok: true,
    surveyTitle: facts.surveyTitle,
    factCount: facts.facts.length,
    questions,
  };
}
