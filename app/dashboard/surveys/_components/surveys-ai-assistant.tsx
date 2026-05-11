"use client";

import { SurveyAiAssistant } from "@/components/surveys/survey-ai-assistant";

export function SurveysAiAssistant(props: {
  surveys: Array<{
    id: string;
    title: string;
    description: string;
    visibility: "private" | "public";
    folderId: string | null;
  }>;
  folders: Array<{ id: string; name: string }>;
}) {
  return (
    <SurveyAiAssistant
      title="KI Survey Assistant"
      buildContext={() => ({
        page: "survey_list" as const,
        surveyId: null,
      })}
      getContextSummary={(ctx) =>
        `${ctx.page} | surveys=${props.surveys.length} | folders=${props.folders.length}`
      }
    />
  );
}

