"use client";

import { useSyncExternalStore } from "react";

import type { FragebogenReviewDraft } from "@/lib/surveys/fragebogen-review-draft";

export type FragebogenWizardDraftSource = "wizard" | "ai" | "clear";

export type FragebogenWizardDraftSnapshot = {
  draft: FragebogenReviewDraft | null;
  source: FragebogenWizardDraftSource;
};

type Listener = () => void;

let snapshot: FragebogenWizardDraftSnapshot = { draft: null, source: "clear" };
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function getFragebogenWizardDraftSnapshot(): FragebogenWizardDraftSnapshot {
  return snapshot;
}

export function getFragebogenWizardDraft(): FragebogenReviewDraft | null {
  return snapshot.draft;
}

export function setFragebogenWizardDraft(
  draft: FragebogenReviewDraft | null,
  source: FragebogenWizardDraftSource = "wizard",
) {
  snapshot = {
    draft,
    source: draft ? source : "clear",
  };
  emit();
}

export function subscribeFragebogenWizardDraft(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFragebogenWizardDraft() {
  return useSyncExternalStore(
    subscribeFragebogenWizardDraft,
    getFragebogenWizardDraftSnapshot,
    getFragebogenWizardDraftSnapshot,
  );
}
