import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
} from "@/lib/ai/anthropic-helpers";
import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import {
  loadSurveyAgentGlobalPrompt,
  resolveSurveyToAgentSystemPrompt,
  SURVEY_AGENT_DEFAULT_MODEL,
  SURVEY_AGENT_GENERATION_MAX_TOKENS,
  SURVEY_AGENT_GENERATION_TIMEOUT_MS,
  SURVEY_TO_AGENT_PROMPT_SLUG,
} from "@/lib/dt/survey-agent-global-prompts";
import {
  parseSurveyAgentCreateOutput,
  SURVEY_AGENT_DELIMITER_FORMAT_INSTRUCTIONS,
} from "@/lib/dt/survey-agent-output";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";

export const surveyAgentPreviewSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(500),
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9_]+$/, "Slug nur Kleinbuchstaben, Ziffern und Unterstrich."),
  prompt_template: z.string().min(200).max(120_000),
  avatar_data: z.record(z.string(), z.unknown()),
  /** Internal admin notes from the global conversion prompt — ignored by create if unused. */
  qa_hinweise: z.array(z.string()).optional(),
  quick_actions: z.array(z.string()).optional().default([]),
  summary: z.string().min(1).max(1_000),
});

export type SurveyAgentPreview = z.infer<typeof surveyAgentPreviewSchema>;

function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /zeitlimit|timeout|aborted/i.test(message);
}

export async function generateSurveyAgentPreview(input: {
  surveyContext: string;
  organisationName: string;
  extraRules?: string;
  referenceExamples: PersonaReferenceExample[];
}): Promise<SurveyAgentPreview> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt.");
  }

  const anthropic = new Anthropic({ apiKey });
  // Sonnet by default — completeness/quality over speed (5+ min OK).
  // Override with ANTHROPIC_DT_SURVEY_MODEL if needed.
  const primaryModel = process.env.ANTHROPIC_DT_SURVEY_MODEL?.trim() || SURVEY_AGENT_DEFAULT_MODEL;
  const models = [primaryModel, resolveDtAnthropicModel("default"), "claude-haiku-4-5-20251001"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const userContent = [
    `Organisation: ${input.organisationName}`,
    "",
    input.extraRules?.trim()
      ? `Zusatzregeln vom Admin:\n${input.extraRules.trim()}\n`
      : "",
    "Umfrage-Antworten:",
    input.surveyContext,
    "",
    "Ausgabe-Hinweis: Der Prompt-Teil muss VOLLSTÄNDIG sein — jede Fact-ID aus der Pflicht-Checkliste abdecken. Keine erfundenen Rankings.",
    "",
    SURVEY_AGENT_DELIMITER_FORMAT_INSTRUCTIONS,
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    resolveSurveyToAgentSystemPrompt(
      await loadSurveyAgentGlobalPrompt(SURVEY_TO_AGENT_PROMPT_SLUG),
      input.referenceExamples,
    ),
    "",
    "---",
    SURVEY_AGENT_DELIMITER_FORMAT_INSTRUCTIONS,
  ].join("\n");

  const startedAt = Date.now();

  async function runOnce(repairHint?: string): Promise<SurveyAgentPreview | null> {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models,
      maxTokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
      stream: true,
      timeoutMs: SURVEY_AGENT_GENERATION_TIMEOUT_MS,
      system,
      messages: [
        {
          role: "user",
          content: repairHint
            ? `${userContent}\n\nKorrigiere deine Antwort: ${repairHint}`
            : userContent,
        },
      ],
    });

    if (!result) return null;

    console.info("[dt] survey-to-agent attempt finished", {
      model: result.model,
      stopReason: result.response.stop_reason,
      elapsedMs: Date.now() - startedAt,
      outputChars: extractAnthropicText(result.response).length,
    });

    if (result.response.stop_reason === "max_tokens") {
      console.warn("[dt] survey-to-agent truncated at max_tokens", {
        model: result.model,
        maxTokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
      });
      const partial = parseSurveyAgentCreateOutput(extractAnthropicText(result.response), {
        truncated: true,
      });
      if (partial) return partial;
      return null;
    }

    const raw = extractAnthropicText(result.response);
    return parseSurveyAgentCreateOutput(raw);
  }

  let preview: SurveyAgentPreview | null = null;
  try {
    preview = await runOnce();
  } catch (err) {
    if (isTimeoutError(err)) throw err;
    throw err;
  }

  // Retry once if first attempt failed quickly (parse/truncate). Allow up to ~6 min total before skipping retry.
  const elapsedMs = Date.now() - startedAt;
  if (!preview && elapsedMs < 360_000) {
    preview = await runOnce(
      "Nutze das Delimiter-Format ===DT_AGENT_META=== / ===DT_AGENT_PROMPT=== / ===DT_AGENT_END===. META ohne prompt_template. Prompt vollständig, mind. 200 Zeichen, alle echten Facts, nichts erfinden.",
    );
  }

  if (!preview) {
    throw new Error("Agent-Vorschau konnte nicht generiert werden. Bitte erneut versuchen.");
  }

  return preview;
}

export function slugifyAgentCandidate(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
