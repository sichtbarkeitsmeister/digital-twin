import Anthropic from "@anthropic-ai/sdk";

export type SurveyChatSystem = Anthropic.Messages.MessageCreateParams["system"];

export function extractAnthropicText(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((item): item is Anthropic.TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

export function extractFirstJsonObject(text: string): string | null {
  const input = stripCodeFences(text);
  const start = input.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;

    if (depth === 0) {
      return input.slice(start, i + 1).trim();
    }
  }

  return null;
}

export function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const normalized = stripCodeFences(text);
    const parsed: unknown = JSON.parse(normalized);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    try {
      const firstObject = extractFirstJsonObject(text);
      if (!firstObject) return null;
      const recovered: unknown = JSON.parse(firstObject);
      return recovered && typeof recovered === "object" && !Array.isArray(recovered)
        ? (recovered as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export function isAnthropicModelNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    status?: unknown;
    type?: unknown;
    error?: { type?: unknown; message?: unknown };
  };
  const status = typeof maybe.status === "number" ? maybe.status : null;
  const topType = typeof maybe.type === "string" ? maybe.type : "";
  const innerType = typeof maybe.error?.type === "string" ? maybe.error.type : "";
  const innerMessage = typeof maybe.error?.message === "string" ? maybe.error.message : "";
  return (
    status === 404 &&
    (topType === "not_found_error" ||
      innerType === "not_found_error" ||
      innerMessage.includes("model:"))
  );
}

/**
 * Anthropic requires streaming for long-running requests (high max_tokens can
 * exceed the non-streaming time limit). Auto-enable above this threshold.
 */
const STREAM_REQUIRED_MAX_TOKENS = 8_192;

export async function callAnthropicFirstAvailable(input: {
  anthropic: Anthropic;
  models: string[];
  maxTokens: number;
  system: SurveyChatSystem;
  messages: Anthropic.MessageParam[];
  /** Force streaming; defaults to true when maxTokens > 8192. */
  stream?: boolean;
}): Promise<{ response: Anthropic.Messages.Message; model: string } | null> {
  const useStream = input.stream ?? input.maxTokens > STREAM_REQUIRED_MAX_TOKENS;
  let lastError: unknown = null;

  for (const model of input.models) {
    try {
      if (useStream) {
        const stream = input.anthropic.messages.stream({
          model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: input.messages,
        });
        const response = await stream.finalMessage();
        return { response, model };
      }

      const response = await input.anthropic.messages.create({
        model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: input.messages,
      });
      return { response, model };
    } catch (error) {
      lastError = error;
      if (isAnthropicModelNotFoundError(error)) continue;
      throw error;
    }
  }
  console.error("Anthropic model selection failed", { lastError, models: input.models });
  return null;
}

/** Combined beta headers for PDF attachments + prompt caching. */
export function anthropicSurveyBetaHeaders(): Record<string, string> {
  return { "anthropic-beta": "pdfs-2024-09-25,prompt-caching-2024-07-31" };
}

export function isPromptCachingEnabled(): boolean {
  const raw = process.env.ANTHROPIC_SURVEY_PROMPT_CACHE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export function isMultiPhaseSurveyCreationEnabled(): boolean {
  const raw = process.env.ANTHROPIC_SURVEY_MULTIPHASE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}
