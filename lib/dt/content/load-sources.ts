import type { SupabaseClient } from "@supabase/supabase-js";

import { listSurveyResponsesForAgentCoverage } from "@/lib/dt/agent-survey-coverage-options";
import { isDefaultTwinAgent, isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import type { ContentLocalSources } from "@/lib/dt/content/types";

export type ContentAnbieterSource = {
  surveyId: string;
  surveyTitle: string;
  responseId: string;
  completedAt: string | null;
  definition: unknown;
  answers: Record<string, unknown>;
};

export type ContentAvatarOption = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  createdAt: string;
};

export type ContentAvatarRow = {
  id: string;
  name: string;
  role: string | null;
  prompt_template: string | null;
  avatar_data: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Newest completed Anbieter questionnaire linked to the organisation (same lookup as Fokus-Keywords). */
export async function loadContentAnbieterSource(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentAnbieterSource | null> {
  const options = await listSurveyResponsesForAgentCoverage({
    organisationId,
    agentKind: "seo_advisor",
    limit: 40,
  });
  const anbieter = options.find((o) => o.purpose === "anbieter" && o.responseId);
  if (!anbieter) return null;

  const [{ data: survey }, { data: response }] = await Promise.all([
    supabase
      .from("surveys")
      .select("id, title, definition")
      .eq("id", anbieter.surveyId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("survey_responses")
      .select("id, answers, completed_at")
      .eq("id", anbieter.responseId)
      .eq("survey_id", anbieter.surveyId)
      .maybeSingle(),
  ]);
  if (!survey || !response) return null;

  return {
    surveyId: survey.id,
    surveyTitle: survey.title ?? anbieter.surveyTitle,
    responseId: response.id,
    completedAt: response.completed_at ?? anbieter.completedAt ?? null,
    definition: survey.definition,
    answers: isRecord(response.answers) ? response.answers : {},
  };
}

/** Avatars for the dropdown: enabled `dt_agents` of the org without SEO advisors, newest first. */
export async function loadContentAvatarOptions(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentAvatarOption[]> {
  const { data } = await supabase
    .from("dt_agents")
    .select("id, name, role, kind, slug, created_at")
    .eq("organisation_id", organisationId)
    .eq("is_enabled", true)
    .order("created_at", { ascending: false });

  return (data ?? [])
    .filter((row) => !isSeoAdvisorAgent(row) && !isDefaultTwinAgent(row))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      role: (row.role as string | null) ?? null,
      kind: row.kind as string,
      createdAt: row.created_at as string,
    }));
}

export async function loadContentAvatarRow(
  supabase: SupabaseClient,
  organisationId: string,
  agentId: string,
): Promise<ContentAvatarRow | null> {
  const { data } = await supabase
    .from("dt_agents")
    .select("id, name, role, prompt_template, avatar_data")
    .eq("organisation_id", organisationId)
    .eq("id", agentId)
    .maybeSingle();
  return (data as ContentAvatarRow | null) ?? null;
}

export async function loadContentLocalSources(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentLocalSources> {
  const [anbieter, avatars, { data: structure }] = await Promise.all([
    loadContentAnbieterSource(supabase, organisationId).catch(() => null),
    loadContentAvatarOptions(supabase, organisationId),
    supabase
      .from("dt_website_structures")
      .select("filename")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);
  return {
    anbieter: anbieter ? { surveyTitle: anbieter.surveyTitle } : null,
    avatarCount: avatars.length,
    structure: structure ? { filename: (structure.filename as string | null) ?? null } : null,
  };
}
