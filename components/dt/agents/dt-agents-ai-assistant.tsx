"use client";

import { useCallback } from "react";

import { SurveyAiAssistant } from "@/components/surveys/survey-ai-assistant";

export function DtAgentsAiAssistant(props: {
  organisationId: string;
  agentId?: string | null;
}) {
  const buildContext = useCallback(
    () => ({
      page: "dt_agents" as const,
      surveyId: null,
      organisationId: props.organisationId,
      agentId: props.agentId ?? null,
    }),
    [props.organisationId, props.agentId],
  );

  return (
    <SurveyAiAssistant
      title="KI Survey Assistant"
      buildContext={buildContext}
    />
  );
}
