import type { ContentModelTier } from "@/lib/dt/content/model-config";

/** Which API answers a step: Claude (Anthropic, the Texte key) or Grok (xAI, its own key). */
export type ContentStepProvider = "anthropic" | "xai";

export type ContentStepDefinition = {
  step: number;
  name: string;
  /** Which model tier (see model-config.ts) the step uses; ignored for the xAI step. */
  tier: ContentModelTier;
  /** Steps that rewrite the whole text; their output replaces the page HTML. */
  writesText: boolean;
  provider: ContentStepProvider;
};

/**
 * The nine steps of the Step-by-Step-Content-Agent, one background job per step:
 * Analyse plans, SEO writes the page, the Faktencheck stops for the customer's answers,
 * GEO / Hormozi / Vermenschlichung are three rewrites (citation, conversion, wording),
 * Lektorat corrects, Watermark Entfernung rephrases every sentence on Grok, Endabnahme
 * halts for the human release.
 */
export const CONTENT_STEPS: readonly ContentStepDefinition[] = [
  { step: 1, name: "Analyse", tier: "write", writesText: false, provider: "anthropic" },
  { step: 2, name: "SEO", tier: "write", writesText: true, provider: "anthropic" },
  { step: 3, name: "Faktencheck", tier: "check", writesText: false, provider: "anthropic" },
  { step: 4, name: "GEO", tier: "write", writesText: true, provider: "anthropic" },
  { step: 5, name: "Hormozi", tier: "write", writesText: true, provider: "anthropic" },
  { step: 6, name: "Vermenschlichung", tier: "write", writesText: true, provider: "anthropic" },
  { step: 7, name: "Lektorat", tier: "check", writesText: true, provider: "anthropic" },
  { step: 8, name: "Watermark Entfernung", tier: "write", writesText: true, provider: "xai" },
  { step: 9, name: "Endabnahme", tier: "check", writesText: false, provider: "anthropic" },
];

export const CONTENT_STEP_COUNT = CONTENT_STEPS.length;
export const CONTENT_STEP_ANALYSE = 1;
export const CONTENT_STEP_SEO = 2;
export const CONTENT_STEP_FAKTENCHECK = 3;
export const CONTENT_STEP_GEO = 4;
export const CONTENT_STEP_HORMOZI = 5;
export const CONTENT_STEP_VERMENSCHLICHUNG = 6;
export const CONTENT_STEP_LEKTORAT = 7;
export const CONTENT_STEP_WATERMARK = 8;
export const CONTENT_STEP_ENDABNAHME = 9;

export function contentStepDefinition(step: number): ContentStepDefinition | null {
  return CONTENT_STEPS.find((s) => s.step === step) ?? null;
}

export function contentStepName(step: number | null | undefined): string {
  return (step != null && contentStepDefinition(step)?.name) || "";
}

/**
 * Step rows written by a previous step order (Recherche, Gliederung, Rohtext …, or the
 * eight-step order with the Endabnahme as step 8) do not match today's names. Such a page
 * cannot continue sensibly: the editor resets it.
 */
export function hasLegacyContentSteps(steps: readonly { step: number; name?: string | null }[]): boolean {
  return steps.some((row) => {
    const name = row.name?.trim();
    return Boolean(name) && name !== contentStepName(row.step);
  });
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
