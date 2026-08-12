import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import {
  parseRawFilledQuestionnaire,
  type RawFilledParseResult,
} from "@/lib/surveys/raw-filled-questionnaire";

const aiFieldSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  type: z
    .enum(["text", "checkbox", "ranking", "radio", "rating", "text_list"])
    .optional()
    .default("text"),
  answer: z.string().optional().nullable().default(null),
  options: z.array(z.string()).optional().default([]),
});

const aiStepSchema = z.object({
  title: z.string().min(1),
  fields: z.array(aiFieldSchema).min(1),
});

const aiExtractSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  steps: z.array(aiStepSchema).min(1),
});

/**
 * Ask Claude to extract questions + answers from an arbitrary filled questionnaire paste
 * (Word exports, emoji sections, missing „Antwort:“ labels, …).
 */
export async function extractFilledQuestionnaireWithAi(input: {
  text: string;
  title?: string;
}): Promise<
  | { ok: true; data: RawFilledParseResult; model: string }
  | { ok: false; message: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      message:
        "KI-Import nicht verfügbar (ANTHROPIC_API_KEY fehlt). Bitte Format mit „Antwort:“-Zeilen nutzen oder Key setzen.",
    };
  }

  const anthropic = new Anthropic({ apiKey });
  const models = resolveSurveyActionModels();

  const system = [
    "Du extrahierst aus einem ausgefüllten Fragebogen (Rohtext, oft aus Word) strukturierte Fragen und Antworten.",
    "Gib NUR ein JSON-Objekt zurück (kein Markdown, keine Erklärung):",
    '{ "title": "...", "description": "...", "steps": [ { "title": "Abschnitt", "fields": [ { "title": "Frage", "description": "Hinweis", "type": "text|checkbox|ranking|radio", "answer": "Antworttext oder null", "options": [] } ] } ] }',
    "Regeln:",
    "- Erfinde keine Antworten. Wenn keine Antwort erkennbar ist: answer = null.",
    "- Behalte Antworttexte möglichst wörtlich.",
    "- Abschnitte anhand von Überschriften/Emojis/Nummerierung gruppieren.",
    "- type=checkbox bei Mehrfachauswahl; ranking bei nummerierten Prioritäten (1. 2. 3.); sonst text.",
    "- options nur setzen, wenn Auswahloptionen im Text klar stehen; sonst aus der Antwort ableiten oder leer lassen.",
    "- Jede erkennbare Frage aufnehmen — nichts Wichtiges weglassen.",
  ].join("\n");

  const userContent = [
    input.title?.trim() ? `Gewünschter Titel: ${input.title.trim()}` : null,
    "Fragebogen-Rohtext:",
    "-----",
    input.text.slice(0, 120_000),
    "-----",
  ]
    .filter(Boolean)
    .join("\n");

  let result: Awaited<ReturnType<typeof callAnthropicFirstAvailable>>;
  try {
    result = await callAnthropicFirstAvailable({
      anthropic,
      models,
      maxTokens: 16_000,
      timeoutMs: 120_000,
      system,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "KI-Extraktion fehlgeschlagen.",
    };
  }

  if (!result) {
    return { ok: false, message: "Kein verfügbares KI-Modell für den Import." };
  }

  const rawText = extractAnthropicText(result.response);
  const json = tryParseJsonObject(rawText);
  if (!json) {
    return {
      ok: false,
      message: "KI-Antwort war kein gültiges JSON. Bitte erneut versuchen.",
    };
  }

  const parsed = aiExtractSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "KI-Struktur ungültig — bitte erneut versuchen.",
    };
  }

  // Rebuild as the strict „Antwort:“ export format, then reuse the proven parser.
  const lines: string[] = [
    input.title?.trim() || parsed.data.title,
    "",
  ];
  for (const step of parsed.data.steps) {
    lines.push(step.title);
    lines.push(`${step.fields.length} Felder`);
    for (const field of step.fields) {
      lines.push(field.title);
      if (field.description?.trim()) lines.push(field.description.trim());
      if (field.type === "checkbox") {
        lines.push("Bitte alle zutreffenden Optionen ankreuzen.");
      } else if (field.type === "ranking") {
        lines.push("Bitte nach Häufigkeit sortieren (oben = häufigste).");
      }
      const answer =
        field.answer?.trim() ||
        (field.options?.length ? field.options.join(", ") : "");
      lines.push(`Antwort: ${answer || ""}`);
      lines.push("");
    }
  }

  const converted = parseRawFilledQuestionnaire(lines.join("\n"), {
    title: input.title?.trim() || parsed.data.title,
  });
  if (!converted.ok) {
    return { ok: false, message: converted.message };
  }

  return { ok: true, data: converted.data, model: result.model };
}
