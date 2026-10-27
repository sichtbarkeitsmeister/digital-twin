import type { ContentModelTier } from "@/lib/dt/content/model-config";

/** Which API answers a step: Claude (Anthropic, the Texte key) or Grok (xAI, its own key). */
export type ContentStepProvider = "anthropic" | "xai";

/**
 * Stable name of a step. Step numbers move when a step is added (20261027 renumbered them);
 * the keys do not, so what is stored by key (`dt_content_pages.skip_steps`) needs no migration.
 */
export type ContentStepKey =
  | "analyse"
  | "seo"
  | "faktencheck"
  | "geo"
  | "aktualitaet"
  | "hormozi"
  | "vermenschlichung"
  | "lektorat"
  | "watermark"
  | "endabnahme";

export type ContentStepDefinition = {
  step: number;
  key: ContentStepKey;
  name: string;
  /** Which model tier (see model-config.ts) the step uses; ignored for the xAI step. */
  tier: ContentModelTier;
  /** Steps that rewrite the whole text; their output replaces the page HTML. */
  writesText: boolean;
  provider: ContentStepProvider;
};

/**
 * The ten steps of the Step-by-Step-Content-Agent, one background job per step:
 * Analyse plans, SEO writes the page, the Faktencheck stops for the customer's answers,
 * GEO rewrites for citation, the Aktualitätsprüfung checks every time-sensitive statement
 * with the web search (and may send the text back to GEO once), Hormozi / Vermenschlichung
 * are two rewrites (conversion, wording), Lektorat corrects, Watermark Entfernung rephrases
 * every sentence on Grok, Endabnahme halts for the human release.
 *
 * Step numbers live only here: everything else uses the constants below. Stored rows carry
 * the numbers, so a new step needs a migration that renumbers them (20261027 did that for
 * the Aktualitätsprüfung). What the editor chooses per page is stored by `key` instead.
 */
export const CONTENT_STEPS: readonly ContentStepDefinition[] = [
  { step: 1, key: "analyse", name: "Analyse", tier: "write", writesText: false, provider: "anthropic" },
  { step: 2, key: "seo", name: "SEO", tier: "write", writesText: true, provider: "anthropic" },
  { step: 3, key: "faktencheck", name: "Faktencheck", tier: "check", writesText: false, provider: "anthropic" },
  { step: 4, key: "geo", name: "GEO", tier: "write", writesText: true, provider: "anthropic" },
  { step: 5, key: "aktualitaet", name: "Aktualitätsprüfung", tier: "write", writesText: true, provider: "anthropic" },
  { step: 6, key: "hormozi", name: "Hormozi", tier: "write", writesText: true, provider: "anthropic" },
  { step: 7, key: "vermenschlichung", name: "Vermenschlichung", tier: "write", writesText: true, provider: "anthropic" },
  { step: 8, key: "lektorat", name: "Lektorat", tier: "check", writesText: true, provider: "anthropic" },
  { step: 9, key: "watermark", name: "Watermark Entfernung", tier: "write", writesText: true, provider: "xai" },
  { step: 10, key: "endabnahme", name: "Endabnahme", tier: "check", writesText: false, provider: "anthropic" },
];

export const CONTENT_STEP_COUNT = CONTENT_STEPS.length;
export const CONTENT_STEP_ANALYSE = 1;
export const CONTENT_STEP_SEO = 2;
export const CONTENT_STEP_FAKTENCHECK = 3;
export const CONTENT_STEP_GEO = 4;
export const CONTENT_STEP_AKTUALITAET = 5;
export const CONTENT_STEP_HORMOZI = 6;
export const CONTENT_STEP_VERMENSCHLICHUNG = 7;
export const CONTENT_STEP_LEKTORAT = 8;
export const CONTENT_STEP_WATERMARK = 9;
export const CONTENT_STEP_ENDABNAHME = 10;

export function contentStepDefinition(step: number): ContentStepDefinition | null {
  return CONTENT_STEPS.find((s) => s.step === step) ?? null;
}

export function contentStepName(step: number | null | undefined): string {
  return (step != null && contentStepDefinition(step)?.name) || "";
}

export function contentStepByKey(key: string): ContentStepDefinition | null {
  return CONTENT_STEPS.find((s) => s.key === key) ?? null;
}

/**
 * The steps an editor may switch off for one page („Schritte“ in the page window). The
 * Analyse always runs (SEO and GEO build on its keywords and questions), and so does the
 * Endabnahme (the release gate). SEO only on pages from the live website, see below.
 * The CHECK of `dt_content_pages.skip_steps` (migration 20261028) lists the same keys.
 */
export const CONTENT_SKIPPABLE_STEP_KEYS = [
  "seo",
  "faktencheck",
  "geo",
  "aktualitaet",
  "hormozi",
  "vermenschlichung",
  "lektorat",
  "watermark",
] as const satisfies readonly ContentStepKey[];
export type ContentSkippableStepKey = (typeof CONTENT_SKIPPABLE_STEP_KEYS)[number];

export function isContentSkippableStepKey(value: unknown): value is ContentSkippableStepKey {
  return typeof value === "string" && (CONTENT_SKIPPABLE_STEP_KEYS as readonly string[]).includes(value);
}

export const CONTENT_SKIP_LOCKED_REASONS = {
  analyse: "Läuft immer: SEO und GEO bauen auf den Keywords und Fragen der Analyse auf.",
  endabnahme: "Läuft immer: die Endabnahme ist die Kontrolle vor der Freigabe.",
  seo: "Nur bei Seiten von der Website: dann wird der aktuelle Live-Text übernommen",
} as const;

export type ContentStepSkippable = { ok: true; reason: null } | { ok: false; reason: string };

/**
 * Whether the editor may switch the step off for this page, and why not (German, shown at
 * the switch). SEO can be skipped only on a page taken over from the crawl: its live text
 * then becomes the starting text, so a page without a live URL would have no text at all.
 */
export function contentStepSkippable(
  page: { source: string; source_url: string | null },
  key: string,
): ContentStepSkippable {
  if (key === "analyse") return { ok: false, reason: CONTENT_SKIP_LOCKED_REASONS.analyse };
  if (key === "endabnahme") return { ok: false, reason: CONTENT_SKIP_LOCKED_REASONS.endabnahme };
  if (!isContentSkippableStepKey(key)) return { ok: false, reason: `Unbekannter Schritt „${key}“.` };
  if (key === "seo" && !(page.source === "crawl" && page.source_url)) {
    return { ok: false, reason: CONTENT_SKIP_LOCKED_REASONS.seo };
  }
  return { ok: true, reason: null };
}

/** The stored list read leniently: known keys only, each once, in the order of the steps. */
export function normalizeSkipSteps(value: unknown): ContentSkippableStepKey[] {
  const wanted = new Set(Array.isArray(value) ? value.filter(isContentSkippableStepKey) : []);
  return CONTENT_SKIPPABLE_STEP_KEYS.filter((key) => wanted.has(key));
}

/** Whether the editor switched this step (by number) off for the page. */
export function contentStepSkippedByUser(skipSteps: readonly string[], step: number): boolean {
  const key = contentStepDefinition(step)?.key;
  return Boolean(key) && isContentSkippableStepKey(key) && skipSteps.includes(key!);
}

/**
 * The run reached `step`: the runner marks it „skipped“ instead of running it when the editor
 * switched it off and the row still has to run (missing, pending, error). A row that is done,
 * waiting, running or already skipped (also by migration 20261027) is never touched.
 */
export function skipsContentStep(
  skipSteps: readonly string[],
  step: number,
  row: { status: string } | null | undefined,
): boolean {
  if (!contentStepSkippedByUser(skipSteps, step)) return false;
  return !row || row.status === "pending" || row.status === "error";
}

/**
 * Step rows written by a previous step order (Recherche, Gliederung, Rohtext …, or the
 * eight-step order with the Endabnahme as step 8) do not match today's names. Such a page
 * cannot continue sensibly: the editor resets it. The nine-step order needs no reset: the
 * migration 20261027 moved its rows 5 … 9 to 6 … 10, where their names match again.
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
 * The next step that will actually run: like `nextContentStep`, but passing the steps the
 * editor switched off (the runner marks those in passing, at no cost and no time).
 */
export function upcomingContentStep(
  steps: readonly { step: number; status: string }[],
  skipSteps: readonly string[] = [],
): number | null {
  const found = CONTENT_STEPS.find((def) => {
    const row = steps.find((s) => s.step === def.step);
    if (row && (row.status === "done" || row.status === "skipped")) return false;
    return !skipsContentStep(skipSteps, def.step, row);
  });
  return found?.step ?? null;
}

/**
 * Header line while a page is `laeuft`. A finished step must not keep saying it is still
 * running: the row stays on that step number until the next one actually starts. A step the
 * editor switched off is not announced; the line names the one after it.
 */
export function runningPageDetail(
  step: number | null,
  steps: readonly { step: number; status: string }[],
  skipSteps: readonly string[] = [],
): string {
  const recorded = step != null ? steps.find((s) => s.step === step) : undefined;
  if (recorded && (recorded.status === "done" || recorded.status === "skipped")) {
    const next = upcomingContentStep(steps, skipSteps);
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
