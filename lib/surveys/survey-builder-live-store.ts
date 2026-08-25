"use client";

import { useSyncExternalStore } from "react";

import type { Survey } from "@/lib/surveys/types";

type Listener = () => void;

let snapshot: Survey | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function getSurveyBuilderLiveSurvey(): Survey | null {
  return snapshot;
}

export function setSurveyBuilderLiveSurvey(survey: Survey | null) {
  snapshot = survey;
  emit();
}

export function subscribeSurveyBuilderLiveSurvey(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSurveyBuilderLiveSurvey() {
  return useSyncExternalStore(
    subscribeSurveyBuilderLiveSurvey,
    getSurveyBuilderLiveSurvey,
    getSurveyBuilderLiveSurvey,
  );
}
