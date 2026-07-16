import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import {
  loadSurveyAgentGlobalPrompt,
  resolveSurveyToAgentSystemPrompt,
  SURVEY_AGENT_GENERATION_MAX_TOKENS,
  SURVEY_TO_AGENT_PROMPT_SLUG,
} from "@/lib/dt/survey-agent-global-prompts";
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
  // Prefer Sonnet for long, complete questionnaire → JSON; Haiku as fallback.
  const primaryModel =
    process.env.ANTHROPIC_DT_SURVEY_MODEL?.trim() || "claude-sonnet-4-6";
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
  ]
    .filter(Boolean)
    .join("\n");

  const system = resolveSurveyToAgentSystemPrompt(
    await loadSurveyAgentGlobalPrompt(SURVEY_TO_AGENT_PROMPT_SLUG),
    input.referenceExamples,
  );

  async function runOnce(repairHint?: string): Promise<SurveyAgentPreview | null> {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models,
      maxTokens: SURVEY_AGENT_GENERATION_MAX_TOKENS,
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

    const raw = extractAnthropicText(result.response);
    const parsed = tryParseJsonObject(raw);
    if (!parsed) return null;

    const validated = surveyAgentPreviewSchema.safeParse(parsed);
    if (!validated.success) {
      return null;
    }

    return validated.data;
  }

  let preview = await runOnce();
  if (!preview) {
    preview = await runOnce(
      "Gib gültiges JSON zurück. slug nur a-z0-9_. prompt_template mindestens 200 Zeichen, deutsch, konkret.",
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
