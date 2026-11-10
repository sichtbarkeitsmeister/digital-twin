import Anthropic from "@anthropic-ai/sdk";

import {
  AnthropicTimeoutError,
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractToolUseInput,
  isForcedToolChoiceUnsupportedError,
} from "@/lib/ai/anthropic-helpers";
import { anthropicModelParams, SONNET_5_5_BUDGET_FACTOR } from "@/lib/ai/anthropic-model-params";
import { reviveStringifiedToolInput } from "@/lib/ai/tolerant-json";
import { CONTENT_API_KEY_ENV, resolveContentApiKey } from "@/lib/dt/content/model-config";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { DT_WEB_RESEARCH_TOOLS, sumServerToolUsage, type DtWebResearchUsage } from "@/lib/dt/seo/web-research";

/** Pipeline error with a hint whether the job runner should try again later. */
export class ContentLlmError extends Error {
  readonly retryable: boolean;
  /** Why the model stopped, when the call got that far (`max_tokens`, `timeout` …); for the step row. */
  readonly stopReason: string | null;
  /** Output tokens of the call that failed, when known. */
  readonly outputTokens: number | null;

  constructor(message: string, retryable: boolean, detail: { stopReason?: string | null; outputTokens?: number | null } = {}) {
    super(message);
    this.name = "ContentLlmError";
    this.retryable = retryable;
    this.stopReason = detail.stopReason ?? null;
    this.outputTokens = detail.outputTokens ?? null;
  }
}

/** Shown at the step when the answer hit max_tokens; the text never reaches the next step. */
export const CONTENT_TRUNCATED_MESSAGE = "Ausgabe abgeschnitten (Token-Limit)";
/** Shown at the step when the time limit cut the stream; the job tries the step again, once. */
export const CONTENT_TIMEOUT_MESSAGE = "Ausgabe unvollständig (Zeitlimit erreicht). Der Schritt wird einmal erneut versucht.";
/** Shown when the one repetition ran into the time limit too: the page stops with the error. */
export const CONTENT_TIMEOUT_FINAL_MESSAGE =
  "Ausgabe unvollständig (Zeitlimit erreicht). Auch die Wiederholung wurde nicht fertig; der Schritt ist fehlgeschlagen.";
/** How often a step is repeated after the time limit cut its answer. */
export const CONTENT_TIMEOUT_MAX_RETRIES = 1;

/** The request ran into the time limit before or while the model answered. */
function timeoutError(message: string): ContentLlmError {
  return new ContentLlmError(message, true, { stopReason: CONTENT_STOP_REASON_TIMEOUT });
}
/** `stop_reason` we record for an answer the time limit cut (the API sent none). */
export const CONTENT_STOP_REASON_TIMEOUT = "timeout";

/**
 * The most a model may be asked to write. Only the old fallbacks are below what the steps ask
 * for; every current model writes far more than 64,000, which no step reaches.
 */
export function contentModelOutputLimit(model: string): number {
  if (/claude-3-5-sonnet/i.test(model)) return 8_192;
  if (/claude-3-/i.test(model)) return 4_096;
  return 64_000;
}

/**
 * A response that is not a finished answer: cut by the time limit (the stream ends without a
 * stop_reason) or by max_tokens. The stream reader closes a cut-off tool call's JSON, so such
 * a response parses like a complete one; it must never be read as the step's result.
 */
function incompleteResponseError(
  result: { response: Anthropic.Messages.Message; timedOut?: boolean },
  messages: { truncated: string; timeout: string },
): ContentLlmError | null {
  const stopReason = result.response.stop_reason;
  const outputTokens = result.response.usage?.output_tokens ?? null;
  if (stopReason === "max_tokens") {
    return new ContentLlmError(messages.truncated, false, { stopReason, outputTokens });
  }
  if (result.timedOut || stopReason == null) {
    return new ContentLlmError(messages.timeout, true, { stopReason: CONTENT_STOP_REASON_TIMEOUT, outputTokens });
  }
  return null;
}

const STEP_TIMEOUT_MS = 240_000;

/** Shared with the DT chat (`lib/ai/anthropic-model-params.ts`): Sonnet 5.5 without extended thinking, 1.35× budget. */
export { SONNET_5_5_BUDGET_FACTOR };
export const contentModelParams = anthropicModelParams;

/** The model's request settings with max_tokens kept within what that model can write. */
function cappedModelParams(model: string, maxTokens: number): ReturnType<typeof anthropicModelParams> {
  const params = contentModelParams(model, maxTokens);
  return { ...params, maxTokens: Math.min(params.maxTokens, contentModelOutputLimit(model)) };
}

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
  /** Another tool's key (the Grounding agent); defaults to the Texte key. */
  apiKey?: string | null;
  /** Name of the tool in error messages („Texte“, „Grounding“). */
  toolLabel?: string;
  /** Tests hand in a stub client; no network. */
  anthropic?: Anthropic;
}): Promise<{
  json: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  /** Why the model stopped (`tool_use`, `end_turn` …); optional so test stubs need not set it. */
  stopReason?: string | null;
}> {
  let anthropic = input.anthropic;
  if (!anthropic) {
    const apiKey = input.apiKey ?? resolveContentApiKey();
    if (!apiKey) {
      throw new ContentLlmError(
        `Der KI-Zugang für ${input.toolLabel ?? "Texte"} ist nicht eingerichtet (Schlüssel fehlt). Bitte die Technik informieren.`,
        false,
      );
    }
    anthropic = new Anthropic({ apiKey });
  }

  const client = anthropic;
  const call = (forced: boolean) =>
    callAnthropicFirstAvailable({
      anthropic: client,
      models: input.models,
      maxTokens: input.maxTokens,
      modelParams: (model) => cappedModelParams(model, input.maxTokens),
      timeoutMs: input.timeoutMs ?? STEP_TIMEOUT_MS,
      stream: true,
      system: forced
        ? input.system
        : `${input.system}\n\nAntworte ausschließlich, indem du das Werkzeug „${input.tool.name}“ genau einmal aufrufst.`,
      tools: [input.tool],
      toolChoice: forced ? { type: "tool", name: input.tool.name } : { type: "auto" },
      messages: [{ role: "user", content: input.user }],
    });
  let result: Awaited<ReturnType<typeof callAnthropicFirstAvailable>>;
  try {
    try {
      result = await call(true);
    } catch (error) {
      // Models that refuse a forced tool_choice still call the tool when asked to.
      if (!isForcedToolChoiceUnsupportedError(error)) throw error;
      result = await call(false);
    }
  } catch (error) {
    // No answer at all within the time limit counts like an answer the limit cut.
    if (error instanceof AnthropicTimeoutError) throw timeoutError(CONTENT_TIMEOUT_MESSAGE);
    throw new ContentLlmError(llmErrorMessage(error), isRetryableLlmError(error));
  }
  if (!result) {
    throw new ContentLlmError(
      "Das KI-Modell ist nicht verfügbar. Bitte die Technik informieren.",
      false,
    );
  }

  // First of all: is this a finished answer? A cut-off one parses like a complete one.
  const incomplete = incompleteResponseError(result, { truncated: CONTENT_TRUNCATED_MESSAGE, timeout: CONTENT_TIMEOUT_MESSAGE });
  if (incomplete) throw incomplete;

  // Claude sometimes sends a nested parameter (the text sections, the findings) as a JSON
  // string, often with an unescaped quote in it; read it back as the declared array/object.
  const json = reviveStringifiedToolInput(
    extractToolUseInput(result.response, input.tool.name),
    input.tool.input_schema as Parameters<typeof reviveStringifiedToolInput>[1],
  );
  if (!json) throw new ContentLlmError("Die KI-Antwort enthielt kein Ergebnis.", true, { stopReason: result.response.stop_reason });
  return { json, usage: sumAnthropicUsage(result.response.usage), model: result.model, stopReason: result.response.stop_reason };
}

// --- web research (Aktualitätsprüfung) ------------------------------------------------------------

/** Rounds of one research call: the server tools may pause a long turn (`pause_turn`). */
const MAX_RESEARCH_ROUNDS = 4;
/** A round that starts with less than this left would only run into the time limit. */
const MIN_RESEARCH_ROUND_MS = 10_000;

export type ContentResearchCall = {
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  web: DtWebResearchUsage;
};

export type ContentResearchResult = {
  /** What the model wrote across all rounds (the research protocol). */
  text: string;
  /** Every content block of every round: search and fetch results, citations. */
  blocks: unknown[];
  calls: ContentResearchCall[];
  model: string;
};

function errorDetail(error: unknown): string {
  const inner = error && typeof error === "object" ? (error as { error?: { error?: { message?: unknown }; message?: unknown } }).error : null;
  const message =
    (typeof inner?.error?.message === "string" && inner.error.message) ||
    (typeof inner?.message === "string" && inner.message) ||
    (error instanceof Error ? error.message : "");
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * The research call failed. A request the API refuses (4xx other than rate limits) means the
 * web search cannot run for this key: the step stops with that reason instead of passing the
 * text as „aktuell“ unchecked.
 */
export function researchErrorMessage(error: unknown): string {
  const status = anthropicStatus(error);
  const detail = errorDetail(error);
  const aboutWebTools = /web[_ ]?(search|fetch)|websuche|server tool/i.test(detail);
  if ((status === 401 || status === 403) && !aboutWebTools) return llmErrorMessage(error);
  if (status != null && status >= 400 && status < 500 && !isRetryableLlmError(error)) {
    return `Die Websuche ist für den Texte-Schlüssel nicht verfügbar (Fehler ${status}${detail ? `: ${detail}` : ""}). Ohne Websuche prüft die Aktualitätsprüfung nichts und lässt die Seite nicht als „aktuell“ durch. Bitte in der Anthropic Console die Websuche für die Organisation des Schlüssels ${CONTENT_API_KEY_ENV} freischalten und dann „Weiterlaufen lassen“.`;
  }
  return llmErrorMessage(error);
}

/**
 * One research turn with Anthropic's server tools (web search, web fetch), tool_choice auto:
 * the model searches, reads and writes its protocol. A forced tool would forbid the searches,
 * which is why the structured result is a second call (`callContentTool`). Paused turns are
 * continued with the same model; every round is billed and reported through `onCall` at once,
 * so the usage is recorded even when a later round fails.
 */
export async function callContentResearch(input: {
  models: string[];
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  /** Defaults to the Texte key. */
  apiKey?: string | null;
  onCall?: (call: ContentResearchCall) => Promise<void> | void;
  /** The web tools with their limits; defaults to the Aktualitätsprüfung's (`DT_WEB_RESEARCH_TOOLS`). */
  tools?: Anthropic.ToolUnion[];
  /** Whose search it is in error messages; defaults to „der Aktualitätsprüfung“. */
  purpose?: string;
  /** Tests hand in a stub client; no network. */
  anthropic?: Anthropic;
}): Promise<ContentResearchResult> {
  const purpose = input.purpose ?? "der Aktualitätsprüfung";
  let anthropic = input.anthropic;
  if (!anthropic) {
    const apiKey = input.apiKey ?? resolveContentApiKey();
    if (!apiKey) {
      throw new ContentLlmError("Der KI-Zugang für Texte ist nicht eingerichtet (Schlüssel fehlt). Bitte die Technik informieren.", false);
    }
    anthropic = new Anthropic({ apiKey });
  }

  const deadline = Date.now() + input.timeoutMs;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input.user }];
  const blocks: unknown[] = [];
  const calls: ContentResearchCall[] = [];
  const texts: string[] = [];
  let models = input.models;

  for (let round = 0; round < MAX_RESEARCH_ROUNDS; round++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_RESEARCH_ROUND_MS) {
      throw timeoutError(`Die Websuche ${purpose} hat das Zeitlimit erreicht. Der Schritt wird einmal erneut versucht.`);
    }
    let result: Awaited<ReturnType<typeof callAnthropicFirstAvailable>>;
    try {
      result = await callAnthropicFirstAvailable({
        anthropic,
        models,
        maxTokens: input.maxTokens,
        modelParams: (model) => cappedModelParams(model, input.maxTokens),
        timeoutMs: remaining,
        stream: true,
        system: input.system,
        tools: input.tools ?? DT_WEB_RESEARCH_TOOLS,
        toolChoice: { type: "auto" },
        messages,
      });
    } catch (error) {
      if (error instanceof AnthropicTimeoutError) {
        throw timeoutError(`Die Websuche ${purpose} hat das Zeitlimit erreicht. Der Schritt wird einmal erneut versucht.`);
      }
      throw new ContentLlmError(researchErrorMessage(error), isRetryableLlmError(error));
    }
    if (!result) throw new ContentLlmError("Das KI-Modell ist nicht verfügbar. Bitte die Technik informieren.", false);

    const { response } = result;
    // A paused turn continues on the model that started it.
    models = [result.model];
    const call: ContentResearchCall = {
      model: result.model,
      usage: sumAnthropicUsage(response.usage),
      web: sumServerToolUsage(response.usage),
    };
    calls.push(call);
    await input.onCall?.(call);
    blocks.push(...response.content);
    const said = extractAnthropicText(response).trim();
    if (said) texts.push(said);

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const incomplete = incompleteResponseError(result, {
      truncated: `Die Recherche ${purpose} wurde abgeschnitten (Token-Limit). Bitte den Schritt wiederholen.`,
      timeout: `Die Websuche ${purpose} hat das Zeitlimit erreicht. Der Schritt wird einmal erneut versucht.`,
    });
    if (incomplete) throw incomplete;
    return { text: texts.join("\n\n"), blocks, calls, model: result.model };
  }
  throw new ContentLlmError(`Die Websuche ${purpose} wurde nicht fertig. Der Schritt wird später erneut versucht.`, true);
}
