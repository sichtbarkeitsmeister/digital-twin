import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
} from "@/lib/ai/anthropic-helpers";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";
import {
  loadSurveyAgentGlobalPrompt,
  SURVEY_AGENT_DEFAULT_MODEL,
  SURVEY_AGENT_GENERATION_MAX_TOKENS,
  SURVEY_AGENT_GENERATION_TIMEOUT_MS,
  SURVEY_REFINE_AGENT_PROMPT_SLUG,
} from "@/lib/dt/survey-agent-global-prompts";
import {
  parseSurveyAgentRefineOutput,
  SURVEY_AGENT_REFINE_DELIMITER_FORMAT_INSTRUCTIONS,
} from "@/lib/dt/survey-agent-output";

export const surveyAgentRefineSchema = z.object({
  prompt_template: z.string().min(200).max(120_000),
  summary: z.string().min(1).max(1_000),
  changed_sections: z.array(z.string().min(1).max(200)).min(1).max(40),
});

export type SurveyAgentRefinePreview = z.infer<typeof surveyAgentRefineSchema>;

export async function generateSurveyAgentRefinement(input: {
  surveyContext: string;
  organisationName: string;
  agentName: string;
  agentRole: string | null;
  agentKind: string;
  currentPromptTemplate: string;
  usesGlobalPrompt: boolean;
  extraRules?: string;
}): Promise<SurveyAgentRefinePreview> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt.");
  }

  const anthropic = new Anthropic({ apiKey });
  const primaryModel = process.env.ANTHROPIC_DT_SURVEY_MODEL?.trim() || SURVEY_AGENT_DEFAULT_MODEL;
  const models = [primaryModel, resolveDtAnthropicModel("default"), "claude-haiku-4-5-20251001"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const userContent = [
    `Organisation: ${input.organisationName}`,
    `Agent: ${input.agentName}`,
    `Rolle: ${input.agentRole ?? "—"}`,
    `Art: ${input.agentKind}`,
    input.usesGlobalPrompt
      ? "Hinweis: Der Agent nutzt aktuell einen globalen Basis-Prompt — der folgende Text ist der organisations-spezifische prompt_template-Teil."
      : "",
    "",
    input.extraRules?.trim()
      ? `Zusatzregeln vom Admin:\n${input.extraRules.trim()}\n`
      : "",
    "Aktueller prompt_template:",
    "```",
    input.currentPromptTemplate,
    "```",
    "",
    "Umfrage-Antworten (neue Erkenntnisse einarbeiten):",
    input.surveyContext,
    "",
    SURVEY_AGENT_REFINE_DELIMITER_FORMAT_INSTRUCTIONS,
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    await loadSurveyAgentGlobalPrompt(SURVEY_REFINE_AGENT_PROMPT_SLUG),
    "",
    "---",
    SURVEY_AGENT_REFINE_DELIMITER_FORMAT_INSTRUCTIONS,
  ].join("\n");

  async function runOnce(repairHint?: string): Promise<SurveyAgentRefinePreview | null> {
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

    if (result.response.stop_reason === "max_tokens") {
      console.warn("[dt] survey-refine truncated at max_tokens", {
        model: result.model,
        maxTokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
      });
      const partial = parseSurveyAgentRefineOutput(extractAnthropicText(result.response), {
        truncated: true,
      });
      if (partial) return partial;
      return null;
    }

    const raw = extractAnthropicText(result.response);
    return parseSurveyAgentRefineOutput(raw);
  }

  let preview = await runOnce();
  if (!preview) {
    preview = await runOnce(
      "Nutze ===DT_AGENT_META=== / ===DT_AGENT_PROMPT=== / ===DT_AGENT_END===. META mit summary + changed_sections. Prompt vollständig, mind. 200 Zeichen.",
    );
  }

  if (!preview) {
    throw new Error(
      "Prompt-Verfeinerung konnte nicht generiert werden. Bitte erneut versuchen.",
    );
  }

  return preview;
}
