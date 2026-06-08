import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import { resolveDtAnthropicModel } from "@/lib/dt/resolve-model";

export const surveyAgentPreviewSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(500),
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9_]+$/, "Slug nur Kleinbuchstaben, Ziffern und Unterstrich."),
  prompt_template: z.string().min(200),
  avatar_data: z.record(z.string(), z.unknown()),
  quick_actions: z.array(z.string()).optional().default([]),
  summary: z.string().min(1).max(300),
});

export type SurveyAgentPreview = z.infer<typeof surveyAgentPreviewSchema>;

function buildReferenceBlock(examples: PersonaReferenceExample[]): string {
  if (examples.length === 0) {
    return "Keine Referenz-Agenten verfügbar — nutze die Standard-Persona-Struktur.";
  }

  return examples
    .map(
      (ex, i) =>
        `### Referenz ${i + 1}: ${ex.name} (${ex.slug})\nRolle: ${ex.role ?? "—"}\navatar_data Keys: ${ex.avatarDataKeys.join(", ") || "—"}\n\nPrompt-Auszug:\n${ex.promptExcerpt}`,
    )
    .join("\n\n---\n\n");
}

function buildSystemPrompt(examples: PersonaReferenceExample[]): string {
  return `Du erstellst DigitalTwin-Persona-Agenten für B2B-Kunden aus abgeschlossenen Umfrage-Antworten.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- name: voller Personenname der Persona
- role: kurze Rollenbeschreibung (1 Satz, für Identitätsblock)
- slug: snake_case, max 48 Zeichen, eindeutig beschreibend (z. B. hedwig_dreirad)
- prompt_template: langer deutscher Markdown-Prompt mit konkretem Inhalt (KEINE {{platzhalter}} — alles ausformuliert)
- avatar_data: JSON-Objekt mit strukturierten Feldern (name_clean, rolle_kurz, alter, disg, situation, tiefste_angst, entscheidungskriterien, einwaende, text_stil, trigger_worte, negative_worte, vorerfahrungen, entscheidungsprozess, … — nur Felder die zur Persona passen)
- quick_actions: optional, Array mit 0–4 kurzen deutschen Starter-Fragen
- summary: ein Satz für die UI-Vorschau

Struktur für prompt_template (Pflicht-Abschnitte, Inhalt aus Umfrage ableiten):
## AKTUELLES DATUM
Heute ist {{current_date}}. (dieser eine Platzhalter ist erlaubt)

Dann: Identität, DEINE PERSÖNLICHKEIT, DEINE SITUATION, Ängste/Sorgen, Entscheidungskriterien, Vorerfahrungen, Einwände, Sprach-Stil, Entscheidungsprozess, WER MIT DIR SPRICHT (User = Mitarbeiter der Organisation), WAS DU KANNST.

Die Persona simuliert typischerweise einen Kunden/Wunschkunden — der Chat-Nutzer ist ein Mitarbeiter der Organisation.

Referenz-Beispiele aus dem System (Struktur und Tiefe nachahmen, Inhalt aus der Umfrage):
${buildReferenceBlock(examples)}`;
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
  const primaryModel = resolveDtAnthropicModel("default");
  const models = [primaryModel, "claude-haiku-4-5-20251001"].filter(
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

  const system = buildSystemPrompt(input.referenceExamples);

  async function runOnce(repairHint?: string): Promise<SurveyAgentPreview | null> {
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
