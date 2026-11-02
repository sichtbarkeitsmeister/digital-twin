import type Anthropic from "@anthropic-ai/sdk";

/**
 * Claude Sonnet 5.5 counts the same German text as about 30 % more tokens than Sonnet 4.6, for
 * which the output budgets are sized (A/B in Texte on 29.10.: 1.31× on the same steps). Without the
 * extra room the Texte Lektorat was cut off at 12,000 tokens.
 */
export const SONNET_5_5_BUDGET_FACTOR = 1.35;

/** No extended thinking on Claude Sonnet 5.5. SDK 0.95's types predate `between_tools`. */
const BETWEEN_TOOLS_THINKING = { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam;

export function isSonnet55Model(model: string): boolean {
  return /sonnet-5-5/i.test(model);
}

/**
 * What a model needs beyond the shared request (`callAnthropicFirstAvailable` `modelParams`).
 * Claude Sonnet 5.5 thinks unless told otherwise and the thinking counts toward max_tokens (the
 * Texte Analyse was cut off after 45 s); `between_tools` is its setting for no extended thinking.
 * It rejects `disabled` and every other model rejects `between_tools`, so the setting goes to
 * Sonnet 5.5 only, and a fallback to another model gets the request as before.
 */
export function anthropicModelParams(
  model: string,
  maxTokens: number,
): { maxTokens: number; thinking?: Anthropic.Messages.ThinkingConfigParam } {
  if (!isSonnet55Model(model)) return { maxTokens };
  return { maxTokens: Math.round(maxTokens * SONNET_5_5_BUDGET_FACTOR), thinking: BETWEEN_TOOLS_THINKING };
}
