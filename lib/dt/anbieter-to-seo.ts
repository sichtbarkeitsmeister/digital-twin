import type { SupabaseClient } from "@supabase/supabase-js";

import { updateDtAgent } from "@/lib/dt/db";
import { ensureSeoAdvisorAgent } from "@/lib/dt/seo/ensure-seo-agent";
import { buildSurveyResponseContextForSeo } from "@/lib/dt/survey-facts";
import type { SurveyFieldQuestionRow } from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";

export const ANBIETER_WISSEN_START = "<!-- DT_ANBIETER_WISSEN_START -->";
export const ANBIETER_WISSEN_END = "<!-- DT_ANBIETER_WISSEN_END -->";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deterministic 1:1 knowledge block for the SEO advisor (no LLM rewrite). */
export function buildAnbieterSeoKnowledgeBlock(input: {
  surveyTitle: string;
  organisationName: string;
  definition: unknown;
  answers: Record<string, unknown>;
  fieldQuestions: SurveyFieldQuestionRow[];
  responseId: string;
}): string {
  const facts = buildSurveyResponseContextForSeo({
    surveyTitle: input.surveyTitle,
    definition: input.definition,
    answers: input.answers,
    fieldQuestions: input.fieldQuestions,
  });

  return [
    `Quelle: Anbieter-Fragebogen „${input.surveyTitle}“`,
    `Organisation: ${input.organisationName}`,
    `Response-ID: ${input.responseId}`,
    `Stand: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Die folgenden Angaben sind verbindliche Unternehmensfakten (1:1 aus dem Fragebogen).",
    "Nutze Zahlen, Namen und Aussagen wörtlich für Firmenfragen, Texte und SEO — nichts erfinden.",
    "Die Fettschrift ist nur das Thema/die Frage; darunter steht der Fakt.",
    "",
    facts,
  ].join("\n");
}

export function mergeAnbieterKnowledgeIntoPromptAppend(
  existing: string | null | undefined,
  knowledgeBody: string,
): string {
  const inner = knowledgeBody.trim();
  const block = [
    ANBIETER_WISSEN_START,
    "## Anbieter-Wissen (Fragebogen)",
    "",
    inner,
    ANBIETER_WISSEN_END,
  ].join("\n");

  const current = (existing ?? "").trim();
  if (!current) return block;

  const start = current.indexOf(ANBIETER_WISSEN_START);
  const end = current.indexOf(ANBIETER_WISSEN_END);
  if (start >= 0 && end > start) {
    const before = current.slice(0, start).trimEnd();
    const after = current.slice(end + ANBIETER_WISSEN_END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n").trim();
  }

  return `${current}\n\n${block}`.trim();
}

export async function previewAnbieterSurveyForSeo(input: {
  surveyId: string;
  responseId: string;
  organisationId: string;
  /** Prefer the authenticated request client (platform admin RLS). */
  supabase: SupabaseClient;
}) {
  const bundle = await loadAnbieterBundle(input.supabase, input.surveyId, input.responseId);
  if (!bundle.ok) return bundle;

  const { data: org, error: orgError } = await input.supabase
    .from("organisations")
    .select("id, name")
    .eq("id", input.organisationId)
    .maybeSingle();

  if (orgError) {
    return {
      ok: false as const,
      status: 500,
      message: `Organisation konnte nicht geladen werden: ${orgError.message}`,
    };
  }

  if (!org) {
    return { ok: false as const, status: 404, message: "Organisation nicht gefunden." };
  }

  const answers: Record<string, unknown> = isRecord(bundle.response.answers)
    ? bundle.response.answers
    : {};

  const knowledgeBody = buildAnbieterSeoKnowledgeBlock({
    surveyTitle: bundle.survey.title,
    organisationName: org.name,
    definition: bundle.survey.definition,
    answers,
    fieldQuestions: bundle.fieldQuestions,
    responseId: input.responseId,
  });

  if (!knowledgeBody.trim()) {
    return {
      ok: false as const,
      status: 400,
      message: "Keine verwertbaren Antworten im Fragebogen gefunden.",
    };
  }

  const { data: seoAgent } = await input.supabase
    .from("dt_agents")
    .select("id, name, prompt_append")
    .eq("organisation_id", input.organisationId)
    .eq("kind", "seo_advisor")
    .eq("is_enabled", true)
    .limit(1)
    .maybeSingle();

  const mergedPreview = mergeAnbieterKnowledgeIntoPromptAppend(
    seoAgent?.prompt_append ?? null,
    knowledgeBody,
  );

  return {
    ok: true as const,
    organisationId: org.id,
    organisationName: org.name,
    knowledgeBody,
    mergedPromptAppendPreview: mergedPreview,
    seoAgentId: seoAgent?.id ?? null,
    seoAgentName: seoAgent?.name ?? "SEO-Berater",
  };
}

export async function applyAnbieterSurveyToSeoAgent(input: {
  surveyId: string;
  responseId: string;
  organisationId: string;
  supabase: SupabaseClient;
}) {
  const preview = await previewAnbieterSurveyForSeo(input);
  if (!preview.ok) return preview;

  // Ensure uses service role (subscribe RPC); fall back to user client if needed.
  let ensureClient: SupabaseClient = input.supabase;
  try {
    ensureClient = createServiceClient();
  } catch {
    ensureClient = input.supabase;
  }

  const ensured = await ensureSeoAdvisorAgent(ensureClient, input.organisationId);
  if (!ensured.agentId) {
    return {
      ok: false as const,
      status: 500,
      message: ensured.error ?? "SEO-Berater konnte nicht angelegt werden.",
    };
  }

  const { data: agent, error: agentError } = await input.supabase
    .from("dt_agents")
    .select("id, prompt_append, organisation_id")
    .eq("id", ensured.agentId)
    .maybeSingle();

  if (agentError) {
    return {
      ok: false as const,
      status: 500,
      message: `SEO-Berater konnte nicht geladen werden: ${agentError.message}`,
    };
  }

  if (!agent || agent.organisation_id !== input.organisationId) {
    return { ok: false as const, status: 404, message: "SEO-Berater nicht gefunden." };
  }

  const nextAppend = mergeAnbieterKnowledgeIntoPromptAppend(
    agent.prompt_append,
    preview.knowledgeBody,
  );

  const { ok, error } = await updateDtAgent({
    agentId: agent.id,
    patch: {
      prompt_append: nextAppend,
      source_survey_id: input.surveyId,
      source_survey_response_id: input.responseId,
    },
  });

  if (!ok) {
    return {
      ok: false as const,
      status: 400,
      message: error ?? "SEO-Wissen konnte nicht gespeichert werden.",
    };
  }

  await input.supabase
    .from("surveys")
    .update({ organisation_id: input.organisationId })
    .eq("id", input.surveyId)
    .is("deleted_at", null);

  return {
    ok: true as const,
    agentId: agent.id,
    organisationId: preview.organisationId,
    organisationName: preview.organisationName,
    knowledgeBody: preview.knowledgeBody,
  };
}

async function loadAnbieterBundle(
  supabase: SupabaseClient,
  surveyId: string,
  responseId: string,
) {
  const { data: survey, error: surveyError } = await supabase
    .from("surveys")
    .select("id, title, definition, organisation_id, purpose")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (surveyError) {
    return {
      ok: false as const,
      status: 500,
      message: `Umfrage konnte nicht geladen werden: ${surveyError.message}`,
    };
  }

  if (!survey) {
    return { ok: false as const, status: 404, message: "Umfrage nicht gefunden." };
  }

  const purpose = normalizeSurveyPurpose((survey as { purpose?: unknown }).purpose);
  if (purpose !== "anbieter") {
    return {
      ok: false as const,
      status: 400,
      message:
        "Diese Umfrage ist keine Anbieter-Umfrage. Bitte im Editor unter „Zweck der Umfrage“ auf „Anbieter (SEO-Wissen)“ stellen und speichern.",
    };
  }

  const { data: response, error: responseError } = await supabase
    .from("survey_responses")
    .select("id, status, answers, completed_at")
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .maybeSingle();

  if (responseError) {
    return {
      ok: false as const,
      status: 500,
      message: `Antwort konnte nicht geladen werden: ${responseError.message}`,
    };
  }

  if (!response) {
    return { ok: false as const, status: 404, message: "Antwort nicht gefunden." };
  }

  if (response.status !== "completed") {
    return {
      ok: false as const,
      status: 400,
      message: "Nur abgeschlossene Antworten können übernommen werden.",
    };
  }

  const { data: questions, error: questionsError } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  if (questionsError) {
    console.warn("[dt] anbieter field questions:", questionsError.message);
  }

  return {
    ok: true as const,
    survey,
    response,
    fieldQuestions: (questions ?? []) as SurveyFieldQuestionRow[],
  };
}
