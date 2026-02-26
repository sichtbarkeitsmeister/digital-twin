"use client";

import * as React from "react";

import { SURVEY_DRAFT_STORAGE_KEY } from "@/lib/surveys/storage";

import { SurveyBuilder } from "@/app/dashboard/_components/surveys/survey-builder";

export function SurveyEditClient({ initialDraftJson }: { initialDraftJson: string }) {
  React.useEffect(() => {
    try {
      window.localStorage.setItem(SURVEY_DRAFT_STORAGE_KEY, initialDraftJson);
    } catch {
      // ignore
    }
  }, [initialDraftJson]);

  return <SurveyBuilder />;
}

