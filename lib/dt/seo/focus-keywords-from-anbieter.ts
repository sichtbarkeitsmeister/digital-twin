import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listSurveyResponsesForAgentCoverage,
} from "@/lib/dt/agent-survey-coverage-options";
import {
  getSurveySteps,
  isPlaceholderOrEmptyAnswer,
  normalizeSurveyAnswer,
} from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";
import type { SurveyField } from "@/lib/surveys/types";

export type AnbieterFocusKeywordsStatus = "found" | "empty" | "no_survey";

export type AnbieterFocusKeywordsResult = {
  status: AnbieterFocusKeywordsStatus;
  /** Comma-separated value for `dt_org_config.focus_keyword`. */
  joined: string | null;
  keywords: string[];
  surveyId: string | null;
  surveyTitle: string | null;
  responseId: string | null;
  matchedFieldTitles: string[];
};

/** Field titles that usually hold Fokus-Keywords in Anbieter questionnaires. */
export function looksLikeFocusKeywordFieldTitle(title: string): boolean {
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/fokus\s*-?\s*keywords?/.test(t)) return true;
  if (/fokuskeywords?/.test(t)) return true;
  if (/keyword\s*-?\s*fokus/.test(t)) return true;
  if (/\bhaupt\s*-?\s*keywords?/.test(t)) return true;
  if (/\bziel\s*-?\s*keywords?/.test(t)) return true;
  if (/seo\s*-?\s*keywords?/.test(t)) return true;
  if (/^keywords?\b/.test(t)) return true;
  if (/\bsuchbegriffe?\b/.test(t) && /fokus|haupt|ziel|seo|ranking/.test(t)) return true;
  return false;
}

function splitKeywordChunks(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((s) => s.length > 0 && !isPlaceholderOrEmptyAnswer(s));
}

/**
 * Pull Fokus-Keywords from an Anbieter survey definition + answers.
 * Prefer dedicated keyword fields; never invent values.
 */
export function extractFocusKeywordsFromAnbieterSurvey(input: {
  definition: unknown;
  answers: Record<string, unknown>;
}): { keywords: string[]; matchedFieldTitles: string[] } {
  const steps = getSurveySteps(input.definition);
  const keywords: string[] = [];
  const matchedFieldTitles: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    for (const field of step.fields ?? []) {
      if (!looksLikeFocusKeywordFieldTitle(field.title ?? "")) continue;
      matchedFieldTitles.push(field.title);
      const raw = input.answers[field.id];
      const answer = normalizeSurveyAnswer(raw, field as SurveyField).trim();
      if (!answer || isPlaceholderOrEmptyAnswer(answer)) continue;
      for (const chunk of splitKeywordChunks(answer)) {
        const key = chunk.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        keywords.push(chunk);
      }
    }
  }

  return { keywords, matchedFieldTitles: [...new Set(matchedFieldTitles)] };
}

export function joinFocusKeywords(keywords: string[]): string | null {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(", ");
}

/**
 * Resolve Fokus-Keywords for an org from the best linked Anbieter questionnaire.
 */
export async function resolveAnbieterFocusKeywordsForOrg(input: {
  organisationId: string;
  supabase: SupabaseClient;
}): Promise<AnbieterFocusKeywordsResult> {
  const empty = (status: AnbieterFocusKeywordsStatus): AnbieterFocusKeywordsResult => ({
    status,
    joined: null,
    keywords: [],
    surveyId: null,
    surveyTitle: null,
    responseId: null,
    matchedFieldTitles: [],
  });

  const options = await listSurveyResponsesForAgentCoverage({
    organisationId: input.organisationId,
    agentKind: "seo_advisor",
    limit: 40,
  });

  const anbieter = options.find((o) => o.purpose === "anbieter" && o.responseId);
  if (!anbieter?.responseId) {
    return empty("no_survey");
  }

  let reader: SupabaseClient = input.supabase;
  try {
    reader = createServiceClient();
  } catch {
    reader = input.supabase;
  }

  const { data: survey } = await reader
    .from("surveys")
    .select("id, title, definition")
    .eq("id", anbieter.surveyId)
    .is("deleted_at", null)
    .maybeSingle();

  const { data: response } = await reader
    .from("survey_responses")
    .select("id, answers")
    .eq("id", anbieter.responseId)
    .eq("survey_id", anbieter.surveyId)
    .maybeSingle();

  if (!survey || !response) {
    return empty("no_survey");
  }

  const answers =
    response.answers && typeof response.answers === "object" && !Array.isArray(response.answers)
      ? (response.answers as Record<string, unknown>)
      : {};

  const extracted = extractFocusKeywordsFromAnbieterSurvey({
    definition: survey.definition,
    answers,
  });
  const joined = joinFocusKeywords(extracted.keywords);

  return {
    status: joined ? "found" : "empty",
    joined,
    keywords: extracted.keywords,
    surveyId: survey.id,
    surveyTitle: survey.title ?? anbieter.surveyTitle ?? null,
    responseId: response.id,
    matchedFieldTitles: extracted.matchedFieldTitles,
  };
}

export async function syncOrgFocusKeywordFromAnbieter(input: {
  organisationId: string;
  supabase: SupabaseClient;
  /** When provided, extract from this survey/response instead of resolving. */
  definition?: unknown;
  answers?: Record<string, unknown>;
  surveyId?: string;
  surveyTitle?: string | null;
  responseId?: string;
}): Promise<AnbieterFocusKeywordsResult> {
  let resolved: AnbieterFocusKeywordsResult;

  if (input.definition !== undefined && input.answers) {
    const extracted = extractFocusKeywordsFromAnbieterSurvey({
      definition: input.definition,
      answers: input.answers,
    });
    const joined = joinFocusKeywords(extracted.keywords);
    resolved = {
      status: joined ? "found" : "empty",
      joined,
      keywords: extracted.keywords,
      surveyId: input.surveyId ?? null,
      surveyTitle: input.surveyTitle ?? null,
      responseId: input.responseId ?? null,
      matchedFieldTitles: extracted.matchedFieldTitles,
    };
  } else {
    resolved = await resolveAnbieterFocusKeywordsForOrg({
      organisationId: input.organisationId,
      supabase: input.supabase,
    });
  }

  if (resolved.status === "found" && resolved.joined) {
    await input.supabase
      .from("dt_org_config")
      .update({ focus_keyword: resolved.joined })
      .eq("organisation_id", input.organisationId);
  }

  return resolved;
}
