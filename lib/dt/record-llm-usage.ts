import type { SupabaseClient } from "@supabase/supabase-js";

export type LlmUsageVia = "direct" | "n8n" | "ghost";

export type RecordLlmUsageInput = {
  organisationId: string;
  userId: string | null;
  chatId?: string | null;
  messageId?: string | null;
  agentId?: string | null;
  mode?: string | null;
  via: LlmUsageVia;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
};

export async function recordLlmUsageEvent(
  supabase: SupabaseClient,
  input: RecordLlmUsageInput,
): Promise<void> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens));
  if (inputTokens === 0 && outputTokens === 0) return;

  const { error } = await supabase.from("dt_llm_usage_events").insert({
    organisation_id: input.organisationId,
    chat_id: input.chatId ?? null,
    message_id: input.messageId ?? null,
    user_id: input.userId,
    agent_id: input.agentId ?? null,
    mode: input.mode ?? null,
    via: input.via,
    model: input.model ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });

  if (error) {
    console.warn("[dt/usage] failed to record usage event:", error.message);
  }
}

export function sumAnthropicUsage(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

export function mergeUsage(
  a: { inputTokens: number; outputTokens: number },
  b: { inputTokens: number; outputTokens: number },
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
