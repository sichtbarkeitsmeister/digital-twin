import { extractSurveyFacts } from "@/lib/dt/survey-facts";
import {
  buildSurveyExamQuestions,
  type SurveyExamAudience,
  type SurveyExamQuestion,
} from "@/lib/dt/survey-exam-questions";
import type { SurveyFieldQuestionRow } from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose, type SurveyPurpose } from "@/lib/surveys/purpose";

export type LoadSurveyExamQuestionsResult =
  | {
      ok: true;
      surveyTitle: string;
      factCount: number;
      questions: SurveyExamQuestion[];
      audience: SurveyExamAudience;
      surveyPurpose: SurveyPurpose;
    }
  | { ok: false; status: number; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Deterministic interviewer script for a completed survey response.
 * Shared by survey preview and agent Testing (persona vs company audience).
 */
export async function loadSurveyExamQuestionsForResponse(
  surveyId: string,
  responseId: string,
  options?: { audience?: SurveyExamAudience },
): Promise<LoadSurveyExamQuestionsResult> {
  const supabase = createServiceClient();

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, definition, purpose")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) {
    return { ok: false, status: 404, message: "Umfrage nicht gefunden." };
  }

  const surveyPurpose = normalizeSurveyPurpose(
    (survey as { purpose?: unknown }).purpose,
  );

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
      message: "Nur abgeschlossene Antworten können als Prüfungsfragen dienen.",
    };
  }

  const { data: questionsRows } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  const facts = extractSurveyFacts({
    surveyTitle: survey.title,
    definition: survey.definition,
    answers: isRecord(response.answers) ? response.answers : {},
    fieldQuestions: (questionsRows ?? []) as SurveyFieldQuestionRow[],
  });

  const audience: SurveyExamAudience =
    options?.audience ?? (surveyPurpose === "anbieter" ? "company" : "persona");

  const questions = buildSurveyExamQuestions(facts.facts, {
    audience,
    surveyTitle: facts.surveyTitle,
  });

  return {
    ok: true,
    surveyTitle: facts.surveyTitle,
    factCount: facts.facts.length,
    questions,
    audience,
    surveyPurpose,
  };
}
