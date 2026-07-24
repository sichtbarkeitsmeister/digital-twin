import { updateDtAgent } from "@/lib/dt/db";
import { ensureSeoAdvisorAgent } from "@/lib/dt/seo/ensure-seo-agent";
import {
  buildSurveyResponseContextForAgent,
  type SurveyFieldQuestionRow,
} from "@/lib/dt/survey-to-agent-context";
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
  const qa = buildSurveyResponseContextForAgent({
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
    "Nutze sie für Firmenfragen, Texte und SEO-Empfehlungen — nichts erfinden.",
    "",
    qa,
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
}) {
  const bundle = await loadAnbieterBundle(input.surveyId, input.responseId);
  if (!bundle.ok) return bundle;

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

  const knowledgeBody = buildAnbieterSeoKnowledgeBlock({
    surveyTitle: bundle.survey.title,
    organisationName: org.name,
    definition: bundle.survey.definition,
    answers,
    fieldQuestions: bundle.fieldQuestions,
    responseId: input.responseId,
  });

  const { data: seoAgent } = await supabase
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
}) {
  const preview = await previewAnbieterSurveyForSeo(input);
  if (!preview.ok) return preview;

  const supabase = createServiceClient();
  const ensured = await ensureSeoAdvisorAgent(supabase, input.organisationId);
  if (!ensured.agentId) {
    return {
      ok: false as const,
      status: 500,
      message: ensured.error ?? "SEO-Berater konnte nicht angelegt werden.",
    };
  }

  const { data: agent } = await supabase
    .from("dt_agents")
    .select("id, prompt_append, organisation_id")
    .eq("id", ensured.agentId)
    .maybeSingle();

  if (!agent || agent.organisation_id !== input.organisationId) {
    return { ok: false as const, status: 404, message: "SEO-Berater nicht gefunden." };
  }

  const nextAppend = mergeAnbieterKnowledgeIntoPromptAppend(
    agent.prompt_append,
    preview.knowledgeBody,
  );

  const { ok, error } = await updateDtAgent({
    agentId: agent.id,
    patch: { prompt_append: nextAppend },
  });

  if (!ok) {
    return {
      ok: false as const,
      status: 400,
      message: error ?? "SEO-Wissen konnte nicht gespeichert werden.",
    };
  }

  // Keep survey linked to org (same as persona flow).
  if (preview.organisationId) {
    await supabase
      .from("surveys")
      .update({ organisation_id: input.organisationId })
      .eq("id", input.surveyId)
      .is("deleted_at", null);
  }

  return {
    ok: true as const,
    agentId: agent.id,
    organisationId: preview.organisationId,
    organisationName: preview.organisationName,
    knowledgeBody: preview.knowledgeBody,
  };
}

async function loadAnbieterBundle(surveyId: string, responseId: string) {
  const supabase = createServiceClient();

  const { data: survey } = await supabase
    .from("surveys")
    .select("id, title, definition, organisation_id, purpose")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!survey) {
    return { ok: false as const, status: 404, message: "Umfrage nicht gefunden." };
  }

  const purpose = normalizeSurveyPurpose(
    (survey as { purpose?: unknown }).purpose,
  );
  if (purpose !== "anbieter") {
    return {
      ok: false as const,
      status: 400,
      message:
        "Diese Umfrage ist keine Anbieter-Umfrage. Für Kunden-Personas bitte „In Agent umwandeln“ nutzen.",
    };
  }

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
      message: "Nur abgeschlossene Antworten können übernommen werden.",
    };
  }

  const { data: questions } = await supabase
    .from("survey_field_questions")
    .select("id, field_id, kind, question, answer")
    .eq("response_id", responseId)
    .order("asked_at", { ascending: true });

  return {
    ok: true as const,
    survey,
    response,
    fieldQuestions: (questions ?? []) as SurveyFieldQuestionRow[],
  };
}
