import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractToolUseInput,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { generateCheckedMixWith, type CheckedMix, type MixSource } from "@/lib/dt/agents/mix-generator";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";
import { dtChatFailureUserMessage } from "@/lib/dt/anthropic-chat";
import {
  generateCheckedAvatarWith,
  proposeAvatarPlanWith,
  type GenerateAvatarResult,
  type ProposeAvatarPlanInput,
  type ProposeAvatarPlanResult,
  type WorkshopToolCall,
} from "@/lib/dt/transcripts/avatar-plan-llm";
import {
  evaluateAnbieterCorpusWith,
  extractPendingStatements,
  prepareAnbieterGuard,
  type EvaluateAnbieterInput,
  type EvaluateAnbieterResult,
  type ExtractStatementsInput,
  type ExtractStatementsResult,
} from "@/lib/dt/transcripts/anbieter-eval";

export type { WorkshopToolCall };

export function workshopFailureMessage(err: unknown, fallback: string): string {
  const mapped = dtChatFailureUserMessage(err);
  if (mapped !== "KI-Antwort fehlgeschlagen. Bitte erneut versuchen.") return mapped;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

const CALL_TIMEOUT_MS = 270_000;

const callTool: WorkshopToolCall = async (input) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY fehlt.");
  const anthropic = new Anthropic({ apiKey });
  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: resolveSurveyActionModels(),
    maxTokens: input.maxTokens ?? 16_384,
    timeoutMs: Math.min(CALL_TIMEOUT_MS, Math.max(1_000, input.timeoutMs ?? CALL_TIMEOUT_MS)),
    stream: true,
    system: input.system,
    tools: [input.tool],
    toolChoice: { type: "tool", name: input.tool.name },
    messages: [{ role: "user", content: input.user }],
  });
  if (!result) throw new Error("Kein verfügbares Modell.");
  const usage = sumAnthropicUsage(result.response.usage);
  const json = extractToolUseInput(result.response, input.tool.name);
  console.info(
    `[workshop] ${input.tool.name}: model=${result.model} stop_reason=${result.response.stop_reason} output_tokens=${usage.outputTokens} max_tokens=${input.maxTokens ?? 16_384}`,
  );
  if (!json) throw new Error("Die KI-Antwort war unvollständig.");
  if (result.response.stop_reason === "max_tokens") {
    throw new Error(
      "Die KI-Antwort wurde abgeschnitten, bevor alle Angaben drin waren. Bitte erneut auswerten.",
    );
  }
  return { json, usage, model: result.model };
};

export async function summarizeTranscript(input: {
  organisationName: string;
  title: string;
  text: string;
}): Promise<{ summary: string; usage: { inputTokens: number; outputTokens: number }; model: string | null }> {
  const tool: Anthropic.Tool = {
    name: "submit_summary",
    description: "Sachliche Zusammenfassung eines Gesprächs.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Zusammenfassung auf Deutsch, 8–20 Sätze. Nur was gesagt wurde.",
        },
      },
      required: ["summary"],
    },
  };
  const { json, usage, model } = await callTool({
    system:
      "Du fasst ein Kundengespräch für das Projektteam zusammen. Nichts glätten, nichts erfinden. Wörtliche Formulierungen zu Zielgruppe, Angebot und Abgrenzung behalten.",
    user: [`Organisation: ${input.organisationName}`, `Titel: ${input.title}`, "", input.text].join("\n"),
    tool,
  });
  const summary = typeof (json as { summary?: unknown }).summary === "string"
    ? (json as { summary: string }).summary.trim()
    : "";
  if (summary.length < 40) throw new Error("Die Zusammenfassung war zu kurz.");
  return { summary, usage, model };
}

export function evaluateAnbieterCorpus(input: Omit<EvaluateAnbieterInput, "call">): Promise<EvaluateAnbieterResult> {
  return evaluateAnbieterCorpusWith({ ...input, call: callTool });
}

/** One round of stage 1 of the Anbieter evaluation; see `extractPendingStatements`. */
export function extractAnbieterStatements(input: Omit<ExtractStatementsInput, "call">): Promise<ExtractStatementsResult> {
  return extractPendingStatements({ ...input, call: callTool });
}

/** The guard rails for the coming run; see `prepareAnbieterGuard`. */
export function prepareAnbieterGuardrails(
  input: Omit<Parameters<typeof prepareAnbieterGuard>[0], "call">,
): ReturnType<typeof prepareAnbieterGuard> {
  return prepareAnbieterGuard({ ...input, call: callTool });
}

export function proposeAvatarPlan(input: Omit<ProposeAvatarPlanInput, "call">): Promise<ProposeAvatarPlanResult> {
  return proposeAvatarPlanWith({ ...input, call: callTool });
}

/** A generator run with the rules checked and up to two rounds of fixes; see `generateCheckedAvatarWith`. */
export function generateCheckedAvatar(input: {
  system: string;
  user: string;
  otherAgentNames: readonly string[];
  deadline?: number;
}): Promise<GenerateAvatarResult & { errors: string[]; fixRounds: number }> {
  return generateCheckedAvatarWith({ ...input, call: callTool });
}

/** The Mix under Agenten, on the same helper and models as the avatar generator; see `generateCheckedMixWith`. */
export function generateCheckedMix(input: {
  system: string;
  sources: readonly MixSource[];
  deadline?: number;
}): Promise<CheckedMix> {
  return generateCheckedMixWith({ ...input, call: callTool });
}
