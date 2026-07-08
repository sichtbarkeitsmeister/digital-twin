import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";

export const surveyAgentRefineSchema = z.object({
  prompt_template: z.string().min(200).max(32_000),
  summary: z.string().min(1).max(300),
  changed_sections: z.array(z.string().min(1).max(120)).min(1).max(12),
});

export type SurveyAgentRefinePreview = z.infer<typeof surveyAgentRefineSchema>;

function buildSystemPrompt(): string {
  return `Du verfeinerst einen bestehenden DigitalTwin-Agenten-Prompt anhand neuer Umfrage-Erkenntnisse.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- prompt_template: der vollständige überarbeitete deutscher Prompt (Markdown), mindestens 200 Zeichen
- summary: ein Satz für die UI — was wurde aus der Umfrage eingearbeitet
- changed_sections: Array kurzer deutscher Labels (z. B. "Entscheidungskriterien", "Sprach-Stil") — welche Abschnitte du angepasst oder ergänzt hast

Regeln:
- Behalte Identität, Rolle, Struktur und bestehende Fähigkeiten des Agenten bei.
- Integriere relevante Erkenntnisse aus der Umfrage (Präferenzen, Formulierungen, Prioritäten, Einschränkungen).
- Lösche keine wichtigen bestehenden Anweisungen; erweitere und präzisiere.
- Keine {{platzhalter}} außer {{current_date}} falls bereits vorhanden.
- Der Prompt muss sofort einsatzbereit sein — konkret und auf Deutsch.`;
}

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
  const primaryModel = resolveDtAnthropicModel("default");
  const models = [primaryModel, "claude-haiku-4-5-20251001"].filter(
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
  ]
    .filter(Boolean)
    .join("\n");

  const system = buildSystemPrompt();

  async function runOnce(repairHint?: string): Promise<SurveyAgentRefinePreview | null> {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models,
      maxTokens: 8192,
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

    const validated = surveyAgentRefineSchema.safeParse(parsed);
    if (!validated.success) return null;

    return validated.data;
  }

  let preview = await runOnce();
  if (!preview) {
    preview = await runOnce(
      "Gib gültiges JSON zurück. prompt_template mindestens 200 Zeichen, deutsch, vollständig. changed_sections mindestens ein Eintrag.",
    );
  }

  if (!preview) {
    throw new Error(
      "Prompt-Verfeinerung konnte nicht generiert werden. Bitte erneut versuchen.",
    );
  }

  return preview;
}
