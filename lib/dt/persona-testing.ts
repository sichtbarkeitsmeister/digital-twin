import type { DtAgentRow } from "@/lib/dt/types";

/** True when the agent was built from a survey response and can offer exam probes. */
export function agentSupportsPersonaTesting(
  agent: Pick<DtAgentRow, "source_survey_id" | "source_survey_response_id"> | null | undefined,
): boolean {
  return Boolean(agent?.source_survey_id && agent?.source_survey_response_id);
}
