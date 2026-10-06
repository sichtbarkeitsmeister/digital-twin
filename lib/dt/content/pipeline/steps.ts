import type { ContentModelTier } from "@/lib/dt/content/model-config";

export type ContentStepDefinition = {
  step: number;
  name: string;
  /** Which model tier (see model-config.ts) the step uses. */
  tier: ContentModelTier;
  /** Steps that rewrite the whole text; their output replaces the page HTML. */
  writesText: boolean;
};

export const CONTENT_STEPS: readonly ContentStepDefinition[] = [
  { step: 1, name: "Recherche", tier: "write", writesText: false },
  { step: 2, name: "Gliederung", tier: "write", writesText: false },
  { step: 3, name: "Rohtext", tier: "write", writesText: true },
  { step: 4, name: "Faktencheck", tier: "check", writesText: false },
  { step: 5, name: "Tonalität & Avatar", tier: "write", writesText: true },
  { step: 6, name: "SEO-Feinschliff", tier: "write", writesText: true },
  { step: 7, name: "Lektorat", tier: "check", writesText: true },
  { step: 8, name: "Endabnahme", tier: "check", writesText: false },
];

export const CONTENT_STEP_COUNT = CONTENT_STEPS.length;
export const CONTENT_STEP_FAKTENCHECK = 4;
export const CONTENT_STEP_LEKTORAT = 7;
export const CONTENT_STEP_ENDABNAHME = 8;

export function contentStepDefinition(step: number): ContentStepDefinition | null {
  return CONTENT_STEPS.find((s) => s.step === step) ?? null;
}

export function contentStepName(step: number | null | undefined): string {
  return (step != null && contentStepDefinition(step)?.name) || "";
}

/** First step that is not done or skipped. `null` when the pipeline has nothing left to run. */
export function nextContentStep(steps: readonly { step: number; status: string }[]): number | null {
  const found = CONTENT_STEPS.find((def) => {
    const row = steps.find((s) => s.step === def.step);
    return !row || (row.status !== "done" && row.status !== "skipped");
  });
  return found?.step ?? null;
}

/**
 * Header line while a page is `laeuft`. A finished step must not keep saying it is still
 * running: the row stays on that step number until the next one actually starts.
 */
export function runningPageDetail(
  step: number | null,
  steps: readonly { step: number; status: string }[],
): string {
  const recorded = step != null ? steps.find((s) => s.step === step) : undefined;
  if (recorded && (recorded.status === "done" || recorded.status === "skipped")) {
    const next = nextContentStep(steps);
    if (next) {
      const name = contentStepName(next);
      return `Schritt ${next} von ${CONTENT_STEPS.length} startet${name ? `: ${name}` : ""}`;
    }
  }
  if (step) {
    const name = contentStepName(step);
    return `Schritt ${step} von ${CONTENT_STEPS.length}${name ? `: ${name}` : ""} läuft`;
  }
  return "Startet …";
}
