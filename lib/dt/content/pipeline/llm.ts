import Anthropic from "@anthropic-ai/sdk";

import { callAnthropicFirstAvailable, extractToolUseInput } from "@/lib/ai/anthropic-helpers";
import { resolveContentApiKey } from "@/lib/dt/content/model-config";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";

/** Pipeline error with a hint whether the job runner should try again later. */
export class ContentLlmError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ContentLlmError";
    this.retryable = retryable;
  }
}

const STEP_TIMEOUT_MS = 240_000;

function anthropicStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** 429/5xx/529 and timeouts pass, 4xx (bad key, bad request) do not. */
export function isRetryableLlmError(error: unknown): boolean {
  const status = anthropicStatus(error);
  if (status != null) return status === 408 || status === 409 || status === 429 || status >= 500;
  const message = error instanceof Error ? error.message : String(error);
  return /zeitlimit|timeout|aborted|ECONNRESET|ETIMEDOUT|fetch failed|overloaded/i.test(message);
}

export function llmErrorMessage(error: unknown): string {
  const status = anthropicStatus(error);
  if (status === 401 || status === 403) {
    return "Der KI-Zugang für Texte wurde abgelehnt (Schlüssel ungültig). Bitte die Technik informieren.";
  }
  if (status === 429 || status === 529 || status === 503) {
    return "Die KI ist gerade ausgelastet. Der Schritt wird später erneut versucht.";
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return "KI-Aufruf fehlgeschlagen.";
}

/**
 * One tool-forced call. The first model in `models` that exists answers; the rest are
 * fallbacks for retired model names. Streaming so long texts are not cut by the
 * non-streaming time limit.
 */
export async function callContentTool(input: {
  models: string[];
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }> {
  const apiKey = resolveContentApiKey();
  if (!apiKey) {
    throw new ContentLlmError(
      "Der KI-Zugang für Texte ist nicht eingerichtet (Schlüssel fehlt). Bitte die Technik informieren.",
      false,
    );
  }

  const anthropic = new Anthropic({ apiKey });
  let result: Awaited<ReturnType<typeof callAnthropicFirstAvailable>>;
  try {
    result = await callAnthropicFirstAvailable({
      anthropic,
      models: input.models,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs ?? STEP_TIMEOUT_MS,
      stream: true,
      system: input.system,
      tools: [input.tool],
      toolChoice: { type: "tool", name: input.tool.name },
      messages: [{ role: "user", content: input.user }],
    });
  } catch (error) {
    throw new ContentLlmError(llmErrorMessage(error), isRetryableLlmError(error));
  }
  if (!result) {
    throw new ContentLlmError(
      "Das KI-Modell ist nicht verfügbar. Bitte die Technik informieren.",
      false,
    );
  }

  const json = extractToolUseInput(result.response, input.tool.name);
  if (!json) throw new ContentLlmError("Die KI-Antwort enthielt kein Ergebnis.", true);
  if (result.response.stop_reason === "max_tokens") {
    throw new ContentLlmError("Die KI-Antwort wurde abgeschnitten. Bitte den Schritt wiederholen.", false);
  }
  return { json, usage: sumAnthropicUsage(result.response.usage), model: result.model };
}
