/**
 * Claude calls of the Grounding check through the shared tool helper (callContentTool).
 * Models: model.ts. Key: the Grounding key chain of the Grounding agent. Every call is recorded in
 * dt_llm_usage_events (mode `grounding_check.<step>`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { callContentTool } from "@/lib/dt/content/pipeline/llm";
import { estimateCostEur } from "@/lib/dt/content/pricing";
import { recordLlmUsageEvent } from "@/lib/dt/record-llm-usage";
import { groundingCheckModels } from "@/lib/dt/seo/grounding-check/model";
import type { GroundingToolSpec } from "@/lib/dt/seo/grounding-check/prompts";
import { resolveGroundingApiKey } from "@/lib/dt/seo/grounding-run/run-step";

export type GroundingToolResult = {
  json: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
};

export async function callGroundingCheckTool(
  service: SupabaseClient,
  input: { organisationId: string; userId: string | null; step: string; spec: GroundingToolSpec; timeoutMs: number },
): Promise<GroundingToolResult> {
  const call = await callContentTool({
    models: groundingCheckModels(),
    system: input.spec.system,
    user: input.spec.user,
    tool: input.spec.tool,
    maxTokens: input.spec.maxTokens,
    timeoutMs: input.timeoutMs,
    apiKey: resolveGroundingApiKey(),
    toolLabel: "Grounding",
  });
  await recordLlmUsageEvent(service, {
    organisationId: input.organisationId,
    userId: input.userId,
    mode: `grounding_check.${input.step}`,
    via: "direct",
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  });
  return {
    json: call.json,
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    costEur: estimateCostEur(call.model, call.usage),
  };
}
