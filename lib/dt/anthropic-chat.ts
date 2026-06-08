import Anthropic from "@anthropic-ai/sdk";

import { extractAnthropicText } from "@/lib/ai/anthropic-helpers";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import { sanitizeForLlmText } from "@/lib/shared/sanitize-llm-text";
import type { DtChatMode } from "@/lib/dt/types";

function sanitizeAnthropicMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { ...message, content: sanitizeForLlmText(message.content) };
    }

    if (!Array.isArray(message.content)) return message;

    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          return { ...block, text: sanitizeForLlmText(block.text) };
        }
        return block;
      }),
    };
  });
}

export async function callDtAnthropicChat(params: {
  system: string;
  messages: Anthropic.MessageParam[];
  mode: DtChatMode;
}): Promise<{ text: string; model: string; stopReason: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt.");
  }

  const model = resolveDtAnthropicModel(params.mode);
  const client = new Anthropic({ apiKey });

  const resp = await client.messages.create({
    model,
    max_tokens: params.mode === "seo" ? 8192 : 4096,
    system: sanitizeForLlmText(params.system),
    messages: sanitizeAnthropicMessages(params.messages),
  });

  return {
    text: extractAnthropicText(resp) || "Keine Antwort erhalten.",
    model,
    stopReason: resp.stop_reason ?? null,
  };
}

export function suggestChatTitle(userMessage: string, assistantMessage: string): string {
  const raw = userMessage.trim() || assistantMessage.trim();
  const oneLine = raw.replace(/\s+/g, " ").slice(0, 60);
  return oneLine.length > 0 ? oneLine : "Neuer Chat";
}
