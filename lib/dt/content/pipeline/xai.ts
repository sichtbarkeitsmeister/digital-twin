/**
 * Grok (xAI) for the one Texte step that runs on it. OpenAI-compatible chat completions
 * against https://api.x.ai/v1, plain text in, plain text out: the step sends sections as
 * HTML and reads sections back, so no function calling and no JSON is involved. Own key
 * (`XAI_API_KEY`), never the Anthropic key, no fallback to Claude: without the key the step
 * fails with a German message.
 */

import { tryParseJsonObject } from "@/lib/ai/anthropic-helpers";
import { ContentLlmError } from "@/lib/dt/content/pipeline/llm";

/** Official xAI variable name; server only, never NEXT_PUBLIC_. */
export const XAI_API_KEY_ENV = "XAI_API_KEY";
export const XAI_MODEL_ENV = "XAI_DT_CONTENT_MODEL";
export const DEFAULT_XAI_MODEL = "grok-4.7";
/**
 * Tried in this order when the configured model answers 404 (retired or mistyped name) or
 * proved too slow for a chunk (see `XaiTimeoutError`). The rewrite is plain language work,
 * so the fast non-reasoning models come first; the reasoning model is the last resort.
 */
export const XAI_MODEL_FALLBACKS = ["grok-4-1-fast-non-reasoning", "grok-4-fast-non-reasoning", "grok-3", "grok-4"] as const;
export const XAI_BASE_URL = "https://api.x.ai/v1";

export const XAI_MISSING_KEY_MESSAGE =
  "Der Grok-Zugang für Texte ist nicht eingerichtet (XAI_API_KEY fehlt). Bitte die Technik informieren.";

const DEFAULT_TIMEOUT_MS = 240_000;

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

/**
 * A model did not answer within the chunk's time. Carries the model and how long it took,
 * so the step can leave that model out next time instead of failing the same way thrice.
 */
export class XaiTimeoutError extends ContentLlmError {
  readonly model: string;
  readonly elapsedMs: number;

  constructor(model: string, elapsedMs: number) {
    super(`Grok (${model}) hat nicht rechtzeitig geantwortet (Zeitlimit). Der Schritt wird später erneut versucht.`, true);
    this.name = "XaiTimeoutError";
    this.model = model;
    this.elapsedMs = elapsedMs;
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type XaiTextCall = {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs?: number;
  /** Candidate models in order; defaults to `resolveXaiModels()`. */
  models?: readonly string[];
  /** Tests pass their own environment and fetch; production uses process.env and global fetch. */
  env?: Env;
  fetchImpl?: FetchLike;
};

export type XaiTextResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  finishReason: string | null;
};

type ChatCompletion = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      refusal?: string | null;
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

type ChatMessage = NonNullable<NonNullable<ChatCompletion["choices"]>[number]["message"]>;

function messageText(message: ChatMessage | null | undefined): string {
  const raw = message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

async function completeOnce(
  model: string,
  input: XaiTextCall,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; result: XaiTextResult } | { ok: false; modelNotFound: boolean; error: ContentLlmError }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = Date.now();
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
      error: aborted
        ? new XaiTimeoutError(model, Date.now() - started)
        : new ContentLlmError(`Grok ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`, true),
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
  const text = messageText(choice?.message);
  const finishReason = choice?.finish_reason ?? null;
  if (!text) {
    const refusal = typeof choice?.message?.refusal === "string" ? choice.message.refusal : "";
    const detail = refusal ? ` Grok: „${snippet(refusal)}“` : finishReason ? ` (finish_reason: ${finishReason})` : "";
    return { ok: false, modelNotFound: false, error: new ContentLlmError(`Die Antwort von Grok enthielt keinen Text.${detail}`, true) };
  }
  if (finishReason === "length") {
    return { ok: false, modelNotFound: false, error: new ContentLlmError("Die Antwort von Grok wurde abgeschnitten. Bitte den Schritt wiederholen.", false) };
  }
  return {
    ok: true,
    result: {
      text,
      usage: {
        inputTokens: Math.max(0, Number(completion.usage?.prompt_tokens ?? 0) || 0),
        outputTokens: Math.max(0, Number(completion.usage?.completion_tokens ?? 0) || 0),
      },
      model,
      finishReason,
    },
  };
}

/**
 * One chat completion on Grok. The first candidate answers; a 404 moves on to the next.
 * Every failure is a `ContentLlmError` with a German message and a retry hint, like the
 * Anthropic caller, so the job runner treats both the same; a timeout is an `XaiTimeoutError`.
 */
export async function callXaiText(input: XaiTextCall): Promise<XaiTextResult> {
  const env = input.env ?? process.env;
  const apiKey = resolveXaiApiKey(env);
  if (!apiKey) throw new ContentLlmError(XAI_MISSING_KEY_MESSAGE, false);
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const candidates = input.models && input.models.length > 0 ? input.models : resolveXaiModels(env);

  let lastError: ContentLlmError | null = null;
  for (const model of candidates) {
    const attempt = await completeOnce(model, input, apiKey, fetchImpl);
    if (attempt.ok) return attempt.result;
    lastError = attempt.error;
    if (!attempt.modelNotFound) throw attempt.error;
  }
  throw lastError ?? new ContentLlmError("Das Grok-Modell ist nicht verfügbar. Bitte die Technik informieren.", false);
}
