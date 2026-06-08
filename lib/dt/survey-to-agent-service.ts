import { createServiceClient } from "@/lib/supabase/service";

import {
  buildSurveyResponseContextForAgent,
  findAgentForSurveyResponse,
  loadPersonaReferenceExamples,
  type SurveyFieldQuestionRow,
} from "@/lib/dt/survey-to-agent-context";
import { generateSurveyAgentPreview } from "@/lib/dt/survey-to-agent-prompt";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function loadSurveyResponseBundle(surveyId: string, responseId: string) {
  const supabase = createServiceClient();

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, definition, organisation_id")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) return { ok: false as const, status: 404, message: "Umfrage nicht gefunden." };

  const { data: response } = await supabase
    .from("survey_responses")
    .select("id, status, answers, completed_at")
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (!response) {
    return { ok: false as const, status: 404, message: "Antwort nicht gefunden." };
  }

  if (response.status !== "completed") {
    return {
      ok: false as const,
      status: 400,
      message: "Nur abgeschlossene Antworten können in Agenten umgewandelt werden.",
    };
  }

  const { data: questions } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  const existingAgent = await findAgentForSurveyResponse(responseId);

  return {
    ok: true as const,
    survey,
    response,
    fieldQuestions: (questions ?? []) as SurveyFieldQuestionRow[],
    existingAgent,
  };
}

export async function assignSurveyOrganisation(
  surveyId: string,
  organisationId: string,
): Promise<{ ok: boolean; message: string }> {
  const supabase = createServiceClient();

  const { data: org } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("id", organisationId)
    .maybeSingle();

  if (!org) {
    return { ok: false, message: "Organisation nicht gefunden." };
  }

  const { error } = await supabase
    .from("surveys")
    .update({ organisation_id: organisationId })
    .eq("id", surveyId)
    .is("deleted_at", null);

  if (error) {
    return { ok: false, message: "Organisation konnte nicht zugewiesen werden." };
  }

  return { ok: true, message: "Organisation zugewiesen." };
}

export async function generateAgentPreviewFromSurvey(input: {
  surveyId: string;
  responseId: string;
  organisationId: string;
  extraRules?: string;
}) {
  const bundle = await loadSurveyResponseBundle(input.surveyId, input.responseId);
  if (!bundle.ok) return bundle;

  if (bundle.existingAgent) {
    return {
      ok: false as const,
      status: 409,
      message: "Für diese Antwort existiert bereits ein Agent.",
      existingAgentId: bundle.existingAgent.id,
    };
  }

  const supabase = createServiceClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("id", input.organisationId)
    .maybeSingle();

  if (!org) {
    return { ok: false as const, status: 404, message: "Organisation nicht gefunden." };
  }

  const answers: Record<string, unknown> = isRecord(bundle.response.answers)
    ? bundle.response.answers
    : {};

  const surveyContext = buildSurveyResponseContextForAgent({
    surveyTitle: bundle.survey.title,
    definition: bundle.survey.definition,
    answers,
    fieldQuestions: bundle.fieldQuestions,
  });

  const referenceExamples = await loadPersonaReferenceExamples(input.organisationId);

  const preview = await generateSurveyAgentPreview({
    surveyContext,
    organisationName: org.name,
    extraRules: input.extraRules,
    referenceExamples,
  });

  if (bundle.survey.organisation_id !== input.organisationId) {
    await assignSurveyOrganisation(input.surveyId, input.organisationId);
  }

  return {
    ok: true as const,
    preview,
    organisationId: input.organisationId,
    organisationName: org.name,
  };
}

export function mapPersonaAgentRpcError(error: string | null): string {
  if (!error) return "Agent konnte nicht angelegt werden.";
  if (error.includes("agent_slug_exists")) {
    return "Dieser Slug existiert in der Organisation bereits — bitte anpassen.";
  }
  if (error.includes("agent_already_created_for_response")) {
    return "Für diese Antwort wurde bereits ein Agent erstellt.";
  }
  if (error.includes("invalid_slug")) {
    return "Ungültiger Slug — nur Kleinbuchstaben, Ziffern und Unterstrich.";
  }
  if (error.includes("forbidden")) return "Keine Berechtigung.";
  return error;
}
