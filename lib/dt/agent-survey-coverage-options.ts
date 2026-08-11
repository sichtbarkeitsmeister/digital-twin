import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSurveyPurpose } from "@/lib/surveys/purpose";
import type { AgentCoverageSurveyOption } from "@/lib/dt/agent-survey-coverage-option-helpers";

export type { AgentCoverageSurveyOption } from "@/lib/dt/agent-survey-coverage-option-helpers";
export {
  formatCoverageOptionLabel,
  pickDefaultCoverageOption,
  suggestCoverageOptionForAgent,
} from "@/lib/dt/agent-survey-coverage-option-helpers";

/**
 * Completed survey responses usable for prompt↔questionnaire coverage checks.
 * Prefers org-linked surveys; falls back to recent completed persona/anbieter responses.
 */
export async function listSurveyResponsesForAgentCoverage(input: {
  organisationId: string;
  agentId?: string | null;
  agentKind?: string | null;
  sourceSurveyId?: string | null;
  sourceResponseId?: string | null;
  limit?: number;
}): Promise<AgentCoverageSurveyOption[]> {
  const supabase = createServiceClient();
  const limit = input.limit ?? 40;
  const preferAnbieter =
    input.agentKind === "seo_advisor" || input.agentKind === "seo";

  const { data: rows, error } = await supabase
    .from("survey_responses")
    .select(
      "id, survey_id, status, completed_at, surveys!inner(id, title, deleted_at, purpose, organisation_id)",
    )
    .eq("status", "completed")
    .is("surveys.deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(120);

  if (error) {
    console.warn("[dt] listSurveyResponsesForAgentCoverage:", error.message);
    return [];
  }

  const options: AgentCoverageSurveyOption[] = [];
  const seen = new Set<string>();

  for (const row of rows ?? []) {
    const survey = row.surveys as
      | {
          id: string;
          title: string;
          purpose?: unknown;
          organisation_id?: string | null;
        }
      | {
          id: string;
          title: string;
          purpose?: unknown;
          organisation_id?: string | null;
        }[];
    const surveyData = Array.isArray(survey) ? survey[0] : survey;
    if (!surveyData?.id || !surveyData.title) continue;

    const purpose = normalizeSurveyPurpose(surveyData.purpose);
    const orgMatch = surveyData.organisation_id === input.organisationId;
    const isSource =
      input.sourceSurveyId === surveyData.id &&
      input.sourceResponseId === row.id;

    // Prefer org-linked; always keep the agent's own source if present.
    if (!orgMatch && !isSource) continue;

    if (preferAnbieter && purpose !== "anbieter" && !isSource) continue;
    if (!preferAnbieter && purpose === "anbieter" && !isSource) continue;

    if (seen.has(row.id)) continue;
    seen.add(row.id);

    options.push({
      surveyId: surveyData.id,
      responseId: row.id,
      surveyTitle: surveyData.title,
      purpose,
      completedAt: row.completed_at ?? null,
      isSource,
    });

    if (options.length >= limit) break;
  }

  // Ensure source is listed even if filtered out above.
  if (
    input.sourceSurveyId &&
    input.sourceResponseId &&
    !options.some((o) => o.responseId === input.sourceResponseId)
  ) {
    const { data: sourceRow } = await supabase
      .from("survey_responses")
      .select(
        "id, survey_id, completed_at, surveys!inner(id, title, purpose, deleted_at)",
      )
      .eq("id", input.sourceResponseId)
      .eq("survey_id", input.sourceSurveyId)
      .maybeSingle();

    if (sourceRow) {
      const survey = sourceRow.surveys as
        | { id: string; title: string; purpose?: unknown }
        | { id: string; title: string; purpose?: unknown }[];
      const surveyData = Array.isArray(survey) ? survey[0] : survey;
      if (surveyData?.title) {
        options.unshift({
          surveyId: sourceRow.survey_id,
          responseId: sourceRow.id,
          surveyTitle: surveyData.title,
          purpose: normalizeSurveyPurpose(surveyData.purpose),
          completedAt: sourceRow.completed_at ?? null,
          isSource: true,
        });
      }
    }
  }

  const responseIds = options.map((o) => o.responseId);
  if (responseIds.length > 0) {
    const { data: owners } = await supabase
      .from("dt_agents")
      .select("id, name, source_survey_response_id")
      .in("source_survey_response_id", responseIds);

    const ownerByResponse = new Map<string, { id: string; name: string }>();
    for (const owner of owners ?? []) {
      const rid = owner.source_survey_response_id;
      if (typeof rid !== "string") continue;
      ownerByResponse.set(rid, { id: owner.id, name: owner.name });
    }

    for (const option of options) {
      const owner = ownerByResponse.get(option.responseId);
      if (owner && owner.id !== input.agentId) {
        option.usedByOtherAgentName = owner.name;
      }
    }
  }

  options.sort((a, b) => {
    if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
    const at = a.completedAt ?? "";
    const bt = b.completedAt ?? "";
    return bt.localeCompare(at);
  });

  return options;
}
