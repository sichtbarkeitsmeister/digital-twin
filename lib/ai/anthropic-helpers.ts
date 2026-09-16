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

/** Drop commas that sit immediately before `}` or `]` (common LLM JSON slip). */
export function stripTrailingCommasInJson(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j += 1;
      if (j < input.length && (input[j] === "}" || input[j] === "]")) {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Close a truncated `{…` payload: finish an open string, drop a dangling comma,
 * then emit the missing `}` / `]` so a cut-off LLM answer can still parse.
 */
export function closeTruncatedJsonObject(text: string): string | null {
  const input = stripCodeFences(text);
  const start = input.indexOf("{");
  if (start < 0) return null;

  let slice = input.slice(start);
  let inString = false;
  let escaped = false;
  const stack: Array<"{" | "["> = [];

  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (!inString && stack.length === 0) return null;

  if (inString) {
    if (escaped) slice += "\\";
    slice += '"';
  }

  slice = slice.replace(/,\s*$/, "");
  while (stack.length > 0) {
    const open = stack.pop();
    slice += open === "{" ? "}" : "]";
  }
  return slice;
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

function* llmJsonCandidates(text: string): Generator<string> {
  const normalized = stripCodeFences(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();

  const variants = [
    normalized,
    escapeControlCharsInJsonStrings(normalized),
    stripTrailingCommasInJson(normalized),
    stripTrailingCommasInJson(escapeControlCharsInJsonStrings(normalized)),
  ];
  for (const variant of variants) yield variant;

  const firstObject = extractFirstJsonObject(normalized);
  if (firstObject) {
    yield firstObject;
    yield escapeControlCharsInJsonStrings(firstObject);
    yield stripTrailingCommasInJson(firstObject);
    yield stripTrailingCommasInJson(escapeControlCharsInJsonStrings(firstObject));
  }

  const closed = closeTruncatedJsonObject(escapeControlCharsInJsonStrings(normalized));
  if (closed) {
    yield closed;
    yield stripTrailingCommasInJson(closed);
  }
}

export function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const seen = new Set<string>();
  for (const candidate of llmJsonCandidates(text)) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const parsed = tryParseOnce(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function extractToolUseInput(
  resp: Anthropic.Messages.Message,
  name: string,
): unknown | null {
  const block = resp.content.find(
    (item): item is Anthropic.ToolUseBlock => item.type === "tool_use" && item.name === name,
  );
  return block ? block.input : null;
}

export function coerceJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") return tryParseJsonObject(value);
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
  /** Optional tool_choice (e.g. force a JSON submit tool). */
  toolChoice?: Anthropic.Messages.ToolChoice;
  /** Extra request headers (PDF document blocks need pdfs-2024-09-25). */
  headers?: Record<string, string>;
}): Promise<{ response: Anthropic.Messages.Message; model: string } | null> {
  const useStream = input.stream ?? input.maxTokens >= STREAM_REQUIRED_MAX_TOKENS;
  let lastError: unknown = null;
  const toolParams = {
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
    ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
  };
  const requestOptions = (signal?: AbortSignal) => ({
    ...(signal ? { signal } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  });

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
          requestOptions(controller?.signal),
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
        requestOptions(controller?.signal),
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
