import type { SupabaseClient } from "@supabase/supabase-js";

import { isDefaultTwinAgent, isSeoAdvisorAgent } from "@/lib/dt/agents/seo-advisor";
import {
  filledWorkshopSections,
  fragebogenSections,
  mergeAnbieterSections,
  type ContentFragebogenFact,
  type WorkshopAnbieterSection,
} from "@/lib/dt/content/mapping";
import { contentDbErrorMessage, isMissingContentColumnError, isMissingContentTableError } from "@/lib/dt/content/store";
import type { ContentLocalSources } from "@/lib/dt/content/types";
import { listSurveysForOrganisation } from "@/lib/dt/list-organisation-surveys";
import { extractSurveyFacts } from "@/lib/dt/survey-facts";
import type { SurveyFieldQuestionRow } from "@/lib/dt/survey-to-agent-context";
import { normalizeAnbieterItems } from "@/lib/dt/transcripts/workshop-model";

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

/** The 13 Anbieter sections from the workshop corpus (always all keys; `current` may be empty). */
export async function loadContentWorkshopAnbieter(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<WorkshopAnbieterSection[]> {
  const { data, error } = await supabase
    .from("dt_workshop_corpus")
    .select("anbieter")
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const anbieter = isRecord(data?.anbieter) ? data.anbieter : null;
  return normalizeAnbieterItems(anbieter?.items).map((item) => ({
    key: item.key,
    label: item.label,
    current: item.current,
  }));
}

export type ContentFragebogen = {
  surveyId: string;
  responseId: string;
  title: string;
  facts: ContentFragebogenFact[];
};

/**
 * The newest completed Anbieter-Fragebogen of the organisation (purpose `anbieter`, as listed
 * under Fragebögen), reduced to its answered questions. Null when there is none.
 */
export async function loadContentFragebogenAnbieter(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentFragebogen | null> {
  const surveys = await listSurveysForOrganisation({ organisationId });
  const candidate = surveys
    .filter((s) => s.purpose === "anbieter" && s.responseId && s.responseStatus === "completed")
    .sort((a, b) => String(b.responseUpdatedAt ?? "").localeCompare(String(a.responseUpdatedAt ?? "")))[0];
  if (!candidate?.responseId) return null;

  const [{ data: survey }, { data: response }, { data: questions }] = await Promise.all([
    supabase.from("surveys").select("id, title, definition").eq("id", candidate.surveyId).maybeSingle(),
    supabase
      .from("survey_responses")
      .select("id, status, answers")
      .eq("id", candidate.responseId)
      .eq("survey_id", candidate.surveyId)
      .maybeSingle(),
    supabase
      .from("survey_field_questions")
      .select("id, field_id, kind, question, answer")
      .eq("response_id", candidate.responseId)
      .order("asked_at", { ascending: true }),
  ]);
  if (!survey || !response || response.status !== "completed") return null;

  const bundle = extractSurveyFacts({
    surveyTitle: (survey.title as string | null) ?? candidate.title,
    definition: survey.definition,
    answers: isRecord(response.answers) ? response.answers : {},
    fieldQuestions: (questions ?? []) as SurveyFieldQuestionRow[],
  });
  if (bundle.facts.length === 0) return null;

  return {
    surveyId: candidate.surveyId,
    responseId: candidate.responseId,
    title: bundle.surveyTitle,
    facts: bundle.facts.map((f) => ({ label: f.label, stepTitle: f.stepTitle, value: f.value })),
  };
}

export type ContentAnbieterSources = {
  /** Workshop sections (all 13 keys) — for the settings suggestion. */
  workshop: WorkshopAnbieterSection[];
  fragebogen: ContentFragebogen | null;
  /** Filled workshop sections plus Fragebogen answers — what the prompts receive. */
  sections: WorkshopAnbieterSection[];
};

/** Both fact sources at once; a failing source counts as empty instead of blocking the other. */
export async function loadContentAnbieterSources(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentAnbieterSources> {
  const [workshop, fragebogen] = await Promise.all([
    loadContentWorkshopAnbieter(supabase, organisationId).catch(() => [] as WorkshopAnbieterSection[]),
    loadContentFragebogenAnbieter(supabase, organisationId).catch((error: unknown) => {
      console.warn("[content] Anbieter-Fragebogen not readable:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  return {
    workshop,
    fragebogen,
    sections: mergeAnbieterSections(workshop, fragebogen ? fragebogenSections(fragebogen.facts) : []),
  };
}

export function anbieterSummary(sources: ContentAnbieterSources): ContentLocalSources["anbieter"] {
  const filled = filledWorkshopSections(sources.workshop);
  const workshop = filled > 0 ? { filled, total: sources.workshop.length } : null;
  const fragebogen = sources.fragebogen
    ? { title: sources.fragebogen.title, facts: sources.fragebogen.facts.length }
    : null;
  return workshop || fragebogen ? { workshop, fragebogen } : null;
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

/** What the crawl of the live site has for this organisation (the second „Seiten“ mode). */
export async function loadContentCrawlSummary(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentLocalSources["crawl"]> {
  const [{ data: config }, { count }, { data: latest }] = await Promise.all([
    supabase.from("dt_org_config").select("website_url").eq("organisation_id", organisationId).maybeSingle(),
    supabase
      .from("dt_site_pages")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("is_excluded", false),
    supabase
      .from("dt_site_pages")
      .select("crawled_at")
      .eq("organisation_id", organisationId)
      .eq("is_excluded", false)
      .order("crawled_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    websiteUrl: (config?.website_url as string | null | undefined)?.trim() || null,
    pageCount: count ?? 0,
    lastCrawledAt: (latest?.crawled_at as string | null | undefined) ?? null,
  };
}

export async function loadContentLocalSources(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentLocalSources> {
  const [anbieter, avatars, { data: structure }, pages, crawl] = await Promise.all([
    loadContentAnbieterSources(supabase, organisationId),
    loadContentAvatarOptions(supabase, organisationId),
    supabase
      .from("dt_website_structures")
      .select("filename, uploaded_at, node_count")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    countContentPages(supabase, organisationId),
    loadContentCrawlSummary(supabase, organisationId),
  ]);
  return {
    anbieter: anbieterSummary(anbieter),
    avatarCount: avatars.length,
    structure: structure
      ? {
          filename: (structure.filename as string | null) ?? null,
          uploadedAt: (structure.uploaded_at as string | null) ?? null,
          nodeCount: Number(structure.node_count ?? 0) || 0,
        }
      : null,
    crawl,
    pages,
  };
}

async function countContentPages(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<ContentLocalSources["pages"]> {
  const { data, error } = await supabase
    .from("dt_content_pages")
    .select("source")
    .eq("organisation_id", organisationId)
    .limit(300);
  if (error) {
    if (isMissingContentTableError(error) || isMissingContentColumnError(error)) {
      throw new Error(contentDbErrorMessage(error, "Seiten konnten nicht geladen werden"));
    }
    return { total: 0, structure: 0, crawl: 0 };
  }
  const rows = data ?? [];
  const crawl = rows.filter((row) => row.source === "crawl").length;
  return { total: rows.length, structure: rows.length - crawl, crawl };
}
