import { listSurveyResponsesForAgentCoverage } from "@/lib/dt/agent-survey-coverage-options";
import { suggestCoverageOptionForAgent } from "@/lib/dt/agent-survey-coverage-option-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export type AgentExamSource = {
  surveyId: string;
  responseId: string;
  /** True when we inferred the questionnaire because the agent had no stored lineage. */
  inferred: boolean;
};

function preferredPurposeForKind(kind: string | null | undefined): "anbieter" | "persona" {
  return kind === "seo_advisor" || kind === "seo" ? "anbieter" : "persona";
}

/**
 * Stored survey lineage, or the org questionnaire that best matches this twin.
 * Personas like Matthias often have a filled Wunschkunden-Fragebogen without
 * source_survey_* columns set.
 */
export async function resolveAgentExamSource(input: {
  organisationId: string;
  agentId: string;
  agentKind?: string | null;
  agentName?: string | null;
  agentRole?: string | null;
  sourceSurveyId?: string | null;
  sourceResponseId?: string | null;
}): Promise<AgentExamSource | null> {
  if (input.sourceSurveyId && input.sourceResponseId) {
    return {
      surveyId: input.sourceSurveyId,
      responseId: input.sourceResponseId,
      inferred: false,
    };
  }

  const options = await listSurveyResponsesForAgentCoverage({
    organisationId: input.organisationId,
    agentId: input.agentId,
    agentKind: input.agentKind,
    sourceSurveyId: input.sourceSurveyId,
    sourceResponseId: input.sourceResponseId,
  });
  if (options.length === 0) return null;

  const preferred = preferredPurposeForKind(input.agentKind);
  const pool = options.filter((o) => o.purpose === preferred);
  const pick = suggestCoverageOptionForAgent(
    pool.length > 0 ? pool : options,
    input.agentName ?? "",
    input.agentRole,
  );
  if (!pick) return null;

  return {
    surveyId: pick.surveyId,
    responseId: pick.responseId,
    inferred: true,
  };
}

/** Remember inferred lineage so the next Test load does not have to rediscover it. */
export async function persistInferredExamSource(input: {
  agentId: string;
  surveyId: string;
  responseId: string;
}): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service
      .from("dt_agents")
      .update({
        source_survey_id: input.surveyId,
        source_survey_response_id: input.responseId,
      })
      .eq("id", input.agentId)
      .is("source_survey_id", null)
      .is("source_survey_response_id", null);
    if (error) {
      console.warn("[dt] persist inferred exam source:", error.message);
    }
  } catch (err) {
    console.warn(
      "[dt] persist inferred exam source:",
      err instanceof Error ? err.message : err,
    );
  }
}
