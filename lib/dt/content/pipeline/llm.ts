import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractToolUseInput,
  isForcedToolChoiceUnsupportedError,
} from "@/lib/ai/anthropic-helpers";
import { reviveStringifiedToolInput } from "@/lib/ai/tolerant-json";
import { CONTENT_API_KEY_ENV, resolveContentApiKey } from "@/lib/dt/content/model-config";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { DT_WEB_RESEARCH_TOOLS, sumServerToolUsage, type DtWebResearchUsage } from "@/lib/dt/seo/web-research";

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

/**
 * Claude Sonnet 5.5 counts the same German text as about 30 % more tokens than Sonnet 4.6, for
 * which the step budgets are sized (A/B on 29.10.: 1.31× on the same steps). Without the extra
 * room its Lektorat was cut off at 12,000 tokens.
 */
export const SONNET_5_5_BUDGET_FACTOR = 1.35;

/** No extended thinking on Claude Sonnet 5.5. SDK 0.95's types predate `between_tools`. */
const BETWEEN_TOOLS_THINKING = { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam;

/**
 * What a model needs beyond the shared request. Claude Sonnet 5.5 thinks unless told otherwise
 * and the thinking counts toward max_tokens (its Analyse was cut off after 45 s); `between_tools`
 * is its setting for no extended thinking. It rejects `disabled` and every other model rejects
 * `between_tools`, so the setting goes to Sonnet 5.5 only. Other models get the request as before.
 */
export function contentModelParams(
  model: string,
  maxTokens: number,
): { maxTokens: number; thinking?: Anthropic.Messages.ThinkingConfigParam } {
  if (!/sonnet-5-5/i.test(model)) return { maxTokens };
  return { maxTokens: Math.round(maxTokens * SONNET_5_5_BUDGET_FACTOR), thinking: BETWEEN_TOOLS_THINKING };
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
}): Promise<{ json: unknown; usage: { inputTokens: number; outputTokens: number }; model: string }> {
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
      modelParams: (model) => contentModelParams(model, input.maxTokens),
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
    throw new ContentLlmError(llmErrorMessage(error), isRetryableLlmError(error));
  }
  if (!result) {
    throw new ContentLlmError(
      "Das KI-Modell ist nicht verfügbar. Bitte die Technik informieren.",
      false,
    );
  }

  // Claude sometimes sends a nested parameter (the text sections, the findings) as a JSON
  // string, often with an unescaped quote in it; read it back as the declared array/object.
  const json = reviveStringifiedToolInput(
    extractToolUseInput(result.response, input.tool.name),
    input.tool.input_schema as Parameters<typeof reviveStringifiedToolInput>[1],
  );
  if (!json) throw new ContentLlmError("Die KI-Antwort enthielt kein Ergebnis.", true);
  if (result.response.stop_reason === "max_tokens") {
    throw new ContentLlmError("Die KI-Antwort wurde abgeschnitten. Bitte den Schritt wiederholen.", false);
  }
  return { json, usage: sumAnthropicUsage(result.response.usage), model: result.model };
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
  /** Tests hand in a stub client; no network. */
  anthropic?: Anthropic;
}): Promise<ContentResearchResult> {
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
      throw new ContentLlmError("Die Websuche der Aktualitätsprüfung hat das Zeitlimit erreicht. Der Schritt wird später erneut versucht.", true);
    }
    let result: Awaited<ReturnType<typeof callAnthropicFirstAvailable>>;
    try {
      result = await callAnthropicFirstAvailable({
        anthropic,
        models,
        maxTokens: input.maxTokens,
        modelParams: (model) => contentModelParams(model, input.maxTokens),
        timeoutMs: remaining,
        stream: true,
        system: input.system,
        tools: DT_WEB_RESEARCH_TOOLS,
        toolChoice: { type: "auto" },
        messages,
      });
    } catch (error) {
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
    if (response.stop_reason === "max_tokens") {
      throw new ContentLlmError("Die Recherche der Aktualitätsprüfung wurde abgeschnitten. Bitte den Schritt wiederholen.", false);
    }
    return { text: texts.join("\n\n"), blocks, calls, model: result.model };
  }
  throw new ContentLlmError("Die Websuche der Aktualitätsprüfung wurde nicht fertig. Der Schritt wird später erneut versucht.", true);
}
