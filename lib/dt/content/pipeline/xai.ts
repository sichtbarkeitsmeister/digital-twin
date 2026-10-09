/**
 * Grok (xAI) for the one Texte step that runs on it. OpenAI-compatible chat completions
 * against https://api.x.ai/v1 with a forced function call, so the step gets the same
 * block JSON the Anthropic steps return. Own key (`XAI_API_KEY`), never the Anthropic key,
 * no fallback to Claude: without the key the step fails with a German message.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { tryParseJsonObject } from "@/lib/ai/anthropic-helpers";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";

/** Official xAI variable name; server only, never NEXT_PUBLIC_. */
export const XAI_API_KEY_ENV = "XAI_API_KEY";
export const XAI_MODEL_ENV = "XAI_DT_CONTENT_MODEL";
export const DEFAULT_XAI_MODEL = "grok-4.7";
/** Tried when the configured model answers 404 (retired or mistyped name). */
const XAI_MODEL_FALLBACKS = ["grok-4"] as const;
export const XAI_BASE_URL = "https://api.x.ai/v1";

export const XAI_MISSING_KEY_MESSAGE =
  "Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt). Bitte die Technik informieren.";

const STEP_TIMEOUT_MS = 240_000;

type Env = Record<string, string | undefined>;

export function resolveXaiApiKey(env: Env = process.env): string | null {
  const key = env[XAI_API_KEY_ENV]?.trim();
  return key ? key : null;
}

/** Configured model first, then the fallbacks, without duplicates. */
export function resolveXaiModels(env: Env = process.env): string[] {
  const configured = env[XAI_MODEL_ENV]?.trim() || DEFAULT_XAI_MODEL;
  return Array.from(new Set([configured, ...XAI_MODEL_FALLBACKS]));
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type XaiToolCall = {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens: number;
  timeoutMs?: number;
  /** Tests pass their own environment and fetch; production uses process.env and global fetch. */
  env?: Env;
  fetchImpl?: FetchLike;
};

export type XaiToolResult = {
  json: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

type ChatCompletion = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

function errorText(body: string): string {
  const parsed = tryParseJsonObject(body);
  const error = parsed?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}

function isModelNotFound(status: number, body: string): boolean {
  return status === 404 || (status === 400 && /model/i.test(body) && /not found|does not exist|unknown|invalid/i.test(body));
}

async function completeOnce(
  model: string,
  input: XaiToolCall,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; result: XaiToolResult } | { ok: false; modelNotFound: boolean; error: ContentLlmError }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? STEP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        tools: [
          {
            type: "function",
            function: { name: input.tool.name, description: input.tool.description ?? "", parameters: input.tool.input_schema },
          },
        ],
        tool_choice: { type: "function", function: { name: input.tool.name } },
        max_tokens: input.maxTokens,
        temperature: 0.7,
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      modelNotFound: false,
      error: new ContentLlmError(
        aborted ? "Grok hat nicht rechtzeitig geantwortet (Zeitlimit). Der Schritt wird später erneut versucht." : `Grok ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
        true,
      ),
    };
  }
  clearTimeout(timer);

  const body = await response.text();
  if (!response.ok) {
    const status = response.status;
    if (isModelNotFound(status, body)) {
      return { ok: false, modelNotFound: true, error: new ContentLlmError(`Grok-Modell „${model}“ ist nicht verfügbar.`, false) };
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        modelNotFound: false,
        error: new ContentLlmError("Der Grok-Zugang für Texte wurde abgelehnt (Schlüssel ungültig). Bitte die Technik informieren.", false),
      };
    }
    if (status === 429 || status >= 500) {
      return {
        ok: false,
        modelNotFound: false,
        error: new ContentLlmError("Grok ist gerade ausgelastet. Der Schritt wird später erneut versucht.", true),
      };
    }
    return { ok: false, modelNotFound: false, error: new ContentLlmError(`Grok hat die Anfrage abgelehnt: ${errorText(body)}`, false) };
  }

  const completion = (tryParseJsonObject(body) ?? {}) as ChatCompletion;
  const choice = completion.choices?.[0];
  const call = choice?.message?.tool_calls?.find((c) => c.function?.name === input.tool.name) ?? choice?.message?.tool_calls?.[0];
  let json: Record<string, unknown> | null = call?.function?.arguments ? tryParseJsonObject(call.function.arguments) : null;
  if (!json && typeof choice?.message?.content === "string") json = tryParseJsonObject(choice.message.content);
  if (choice?.finish_reason === "length") {
    return { ok: false, modelNotFound: false, error: new ContentLlmError("Die Antwort von Grok wurde abgeschnitten. Bitte den Schritt wiederholen.", false) };
  }
  if (!json) {
    return { ok: false, modelNotFound: false, error: new ContentLlmError("Die Antwort von Grok enthielt kein Ergebnis.", true) };
  }
  return {
    ok: true,
    result: {
      json,
      usage: {
        inputTokens: Math.max(0, Number(completion.usage?.prompt_tokens ?? 0) || 0),
        outputTokens: Math.max(0, Number(completion.usage?.completion_tokens ?? 0) || 0),
      },
      model,
    },
  };
}

/**
 * One forced tool call on Grok. The configured model answers; a 404 moves on to the next
 * candidate. Every failure is a `ContentLlmError` with a German message and a retry hint,
 * like the Anthropic caller, so the job runner treats both the same.
 */
export async function callXaiTool(input: XaiToolCall): Promise<XaiToolResult> {
  const env = input.env ?? process.env;
  const apiKey = resolveXaiApiKey(env);
  if (!apiKey) throw new ContentLlmError(XAI_MISSING_KEY_MESSAGE, false);
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));

  let lastError: ContentLlmError | null = null;
  for (const model of resolveXaiModels(env)) {
    const attempt = await completeOnce(model, input, apiKey, fetchImpl);
    if (attempt.ok) return attempt.result;
    lastError = attempt.error;
    if (!attempt.modelNotFound) throw attempt.error;
  }
  throw lastError ?? new ContentLlmError("Das Grok-Modell ist nicht verfügbar. Bitte die Technik informieren.", false);
}
