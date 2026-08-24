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

/** Escape raw control characters inside JSON string literals (common LLM slip). */
export function escapeControlCharsInJsonStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') inString = true;
    out += ch;
  }

  return out;
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

function tryParseOnce(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const normalized = stripCodeFences(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();

  const direct = tryParseOnce(normalized);
  if (direct) return direct;

  const escaped = tryParseOnce(escapeControlCharsInJsonStrings(normalized));
  if (escaped) return escaped;

  const firstObject = extractFirstJsonObject(normalized);
  if (firstObject) {
    const fromSlice = tryParseOnce(firstObject);
    if (fromSlice) return fromSlice;
    const fromEscapedSlice = tryParseOnce(escapeControlCharsInJsonStrings(firstObject));
    if (fromEscapedSlice) return fromEscapedSlice;
  }

  return null;
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
 * exceed the non-streaming time limit). Multiphase outline/expand uses 8192 —
 * the previous `>` threshold left those on non-streaming and they hung/failed
 * on large Fragebogen pastes. Default to streaming always; opt out explicitly.
 */
const STREAM_REQUIRED_MAX_TOKENS = 4_096;

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return name === "AbortError" || /aborted|abort|timeout/i.test(message);
}

export async function callAnthropicFirstAvailable(input: {
  anthropic: Anthropic;
  models: string[];
  maxTokens: number;
  system: SurveyChatSystem;
  messages: Anthropic.MessageParam[];
  /** Force streaming on/off; defaults to true when maxTokens >= 4096. */
  stream?: boolean;
  /** Abort the request after this many ms (prevents hung UI when platform kills the route). */
  timeoutMs?: number;
  /** Optional Anthropic tools (Survey KI workspace retrieval). */
  tools?: Anthropic.Tool[];
}): Promise<{ response: Anthropic.Messages.Message; model: string } | null> {
  const useStream = input.stream ?? input.maxTokens >= STREAM_REQUIRED_MAX_TOKENS;
  let lastError: unknown = null;
  const toolParams = input.tools && input.tools.length > 0 ? { tools: input.tools } : {};

  for (const model of input.models) {
    const controller = input.timeoutMs ? new AbortController() : null;
    let streamHandle: { abort: () => void } | null = null;
    const timer =
      controller && input.timeoutMs
        ? setTimeout(() => {
            try {
              streamHandle?.abort();
            } catch {
              /* ignore */
            }
            controller.abort();
          }, input.timeoutMs)
        : null;

    try {
      if (useStream) {
        const stream = input.anthropic.messages.stream(
          {
            model,
            max_tokens: input.maxTokens,
            system: input.system,
            messages: input.messages,
            ...toolParams,
          },
          controller ? { signal: controller.signal } : undefined,
        );
        streamHandle = stream;
        const response = await stream.finalMessage();
        return { response, model };
      }

      const response = await input.anthropic.messages.create(
        {
          model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: input.messages,
          ...toolParams,
        },
        controller ? { signal: controller.signal } : undefined,
      );
      return { response, model };
    } catch (error) {
      lastError = error;
      if (isAbortError(error)) {
        throw new Error(
          `KI-Generierung hat das Zeitlimit (${Math.round((input.timeoutMs ?? 0) / 1000)}s) überschritten. Bitte erneut versuchen — bei sehr großen Fragebögen ggf. erneut klicken.`,
        );
      }
      if (isAnthropicModelNotFoundError(error)) continue;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
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
