import type { ContentModelTier } from "@/lib/dt/content/model-config";

/**
 * The four steps of the Grounding agent, one background job per page
 * (kind `grounding.page`): collect the facts, check them, build the page, check the page.
 * The run halts for the customer's answers after step 2 and ends after step 4 with the
 * HTML ready for the human fact review (Standard v1.7).
 */
export type GroundingStepDefinition = {
  step: number;
  name: string;
  tier: ContentModelTier;
  /** Needs most of a worker tick (long output). */
  long: boolean;
};

export const GROUNDING_STEPS: readonly GroundingStepDefinition[] = [
  { step: 1, name: "Fakten sammeln", tier: "write", long: false },
  { step: 2, name: "Faktencheck", tier: "check", long: false },
  { step: 3, name: "Seite bauen", tier: "write", long: true },
  { step: 4, name: "Endprüfung", tier: "check", long: true },
];

export const GROUNDING_STEP_COUNT = GROUNDING_STEPS.length;
export const GROUNDING_STEP_FAKTEN = 1;
export const GROUNDING_STEP_FAKTENCHECK = 2;
export const GROUNDING_STEP_BAUEN = 3;
export const GROUNDING_STEP_ENDPRUEFUNG = 4;

export function groundingStepDefinition(step: number): GroundingStepDefinition | null {
  return GROUNDING_STEPS.find((s) => s.step === step) ?? null;
}

export function groundingStepName(step: number | null | undefined): string {
  return (step != null && groundingStepDefinition(step)?.name) || "";
}

/** First step that is not done or skipped; null when nothing is left. */
export function nextGroundingStep(steps: readonly { step: number; status: string }[]): number | null {
  const found = GROUNDING_STEPS.find((def) => {
    const row = steps.find((s) => s.step === def.step);
    return !row || (row.status !== "done" && row.status !== "skipped");
  });
  return found?.step ?? null;
}

export function groundingStepLabel(step: number | null | undefined): string {
  if (!step) return "";
  const name = groundingStepName(step);
  return `Schritt ${step} von ${GROUNDING_STEP_COUNT}${name ? `: ${name}` : ""}`;
}

/** Header line while a page is `laeuft`. */
export function runningGroundingDetail(
  step: number | null,
  steps: readonly { step: number; status: string }[],
): string {
  const recorded = step != null ? steps.find((s) => s.step === step) : undefined;
  if (recorded && (recorded.status === "done" || recorded.status === "skipped")) {
    const next = nextGroundingStep(steps);
    if (next) return `${groundingStepLabel(next)} startet`;
  }
  if (step) return `${groundingStepLabel(step)} läuft`;
  return "Startet …";
}
