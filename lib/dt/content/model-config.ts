/**
 * Which Claude model the content pipeline uses, and where that comes from.
 *
 * Order of precedence (first non-empty wins):
 *   1. `app_settings` rows `content_model` / `content_check_model` (change at runtime, no deploy)
 *   2. env `ANTHROPIC_DT_CONTENT_MODEL` / `ANTHROPIC_DT_CONTENT_CHECK_MODEL`
 *   3. the defaults below
 *
 * The API key is `ANTHROPIC_DT_CONTENT_API_KEY` only. It does not fall back to `ANTHROPIC_API_KEY`,
 * so Texte spend stays its own line in the Anthropic console. Server env, never NEXT_PUBLIC_.
 * Pure helpers here; `loadContentModelConfig` in `model-config-db.ts` reads `app_settings`.
 */

/** Dedicated Anthropic key for the Texte pipeline. Usage of this key is the tool's spend. */
export const CONTENT_API_KEY_ENV = "ANTHROPIC_DT_CONTENT_API_KEY";

export function resolveContentApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env[CONTENT_API_KEY_ENV]?.trim();
  return key ? key : null;
}

export const DEFAULT_CONTENT_MODEL = "claude-sonnet-4-6";

/** Older models Anthropic still serves, tried only when the preferred one answers 404. */
const CONTENT_MODEL_FALLBACKS = [
  DEFAULT_CONTENT_MODEL,
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-latest",
] as const;

export const CONTENT_MODEL_ENV = {
  write: "ANTHROPIC_DT_CONTENT_MODEL",
  check: "ANTHROPIC_DT_CONTENT_CHECK_MODEL",
} as const;

export const CONTENT_MODEL_SETTING_KEYS = {
  write: "content_model",
  check: "content_check_model",
} as const;

export type ContentModelTier = keyof typeof CONTENT_MODEL_ENV;
export type ContentModelSource = "app_settings" | "env" | "default";

export type ContentModelConfig = {
  /** Writing steps: Analyse, SEO, GEO, Hormozi, Vermenschlichung. */
  write: string[];
  /** Checking steps: Faktencheck, Lektorat, Endabnahme. Same as `write` unless set. */
  check: string[];
  source: Record<ContentModelTier, ContentModelSource>;
};

export type ContentModelOverrides = Partial<Record<ContentModelTier, string | null | undefined>>;

function uniqueModels(candidates: string[]): string[] {
  return Array.from(new Set(candidates.map((m) => m.trim()).filter(Boolean)));
}

function pick(
  override: string | null | undefined,
  envValue: string | undefined,
  fallback: { value: string; source: ContentModelSource },
): { value: string; source: ContentModelSource } {
  if (override?.trim()) return { value: override.trim(), source: "app_settings" };
  if (envValue?.trim()) return { value: envValue.trim(), source: "env" };
  return fallback;
}

/**
 * Candidate lists per tier. `overrides` are the `app_settings` values (null = not set);
 * `env` defaults to `process.env` and is a parameter only so tests stay deterministic.
 */
export function resolveContentModels(
  overrides: ContentModelOverrides = {},
  env: Record<string, string | undefined> = process.env,
): ContentModelConfig {
  const write = pick(overrides.write, env[CONTENT_MODEL_ENV.write], {
    value: DEFAULT_CONTENT_MODEL,
    source: "default",
  });
  const check = pick(overrides.check, env[CONTENT_MODEL_ENV.check], write);
  return {
    write: uniqueModels([write.value, ...CONTENT_MODEL_FALLBACKS]),
    check: uniqueModels([check.value, ...CONTENT_MODEL_FALLBACKS]),
    source: { write: write.source, check: check.source },
  };
}

/** Short human-readable summary for the Texte tab ("claude-sonnet-4-6 · aus Umgebung"). */
export function describeContentModelSource(source: ContentModelSource): string {
  switch (source) {
    case "app_settings":
      return "aus app_settings";
    case "env":
      return "aus Umgebungsvariable";
    default:
      return "Standard";
  }
}
