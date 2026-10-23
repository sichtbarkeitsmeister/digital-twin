/**
 * Model order of the Grounding check: ANTHROPIC_DT_GROUNDING_MODEL, else the SEO model
 * (ANTHROPIC_DT_SEO_MODEL or its default). Later entries are fallbacks for retired names.
 */

import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";

export function groundingCheckModels(env: Record<string, string | undefined> = process.env): string[] {
  const override = env.ANTHROPIC_DT_GROUNDING_MODEL?.trim();
  const seo = env.ANTHROPIC_DT_SEO_MODEL?.trim() || resolveDtAnthropicModel("seo");
  return [...new Set([override, seo].filter((m): m is string => Boolean(m)))];
}
