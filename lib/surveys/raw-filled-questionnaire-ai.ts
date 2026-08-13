import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import {
  resolveSurveyActionModels,
  resolveSurveyUtilityModels,
} from "@/lib/ai/survey-model-config";
import {
  normalizeWordQuestionnaireText,
  splitQuestionnaireIntoAiChunks,
} from "@/lib/surveys/raw-filled-questionnaire-chunks";
import {
  parseRawFilledQuestionnaire,
  type RawFilledParseResult,
} from "@/lib/surveys/raw-filled-questionnaire";

export {
  normalizeWordQuestionnaireText,
  splitQuestionnaireIntoAiChunks,
} from "@/lib/surveys/raw-filled-questionnaire-chunks";

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

const aiChunkSchema = z.object({
  title: z.string().min(1).optional(),
  fields: z.array(aiFieldSchema).min(1),
});

type AiStep = z.infer<typeof aiStepSchema>;
type AiField = z.infer<typeof aiFieldSchema>;

function buildStrictExportFromSteps(
  title: string,
  description: string,
  steps: AiStep[],
): string {
  const lines: string[] = [title, ""];
  if (description.trim()) {
    lines.push(description.trim(), "");
  }
  for (const step of steps) {
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
  return lines.join("\n");
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function extractOneChunk(input: {
  anthropic: Anthropic;
  models: string[];
  titleHint: string;
  body: string;
  timeoutMs: number;
}): Promise<{ ok: true; step: AiStep; model: string } | { ok: false; message: string }> {
  const system = [
    "Du extrahierst aus einem ABSCHNITT eines ausgefüllten Fragebogens Fragen und Antworten.",
    "Gib NUR JSON zurück:",
    '{ "title": "Abschnittstitel", "fields": [ { "title": "Frage", "description": "", "type": "text|checkbox|ranking|radio", "answer": "Antwort oder null", "options": [] } ] }',
    "Regeln: keine erfundenen Antworten; Antworten wörtlich; jede erkennbare Frage aufnehmen.",
  ].join("\n");

  try {
    const result = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: input.models,
      maxTokens: 4_000,
      timeoutMs: input.timeoutMs,
      stream: true,
      system,
      messages: [
        {
          role: "user",
          content: [
            `Abschnitt: ${input.titleHint}`,
            "-----",
            input.body.slice(0, 12_000),
            "-----",
          ].join("\n"),
        },
      ],
    });
    if (!result) return { ok: false, message: "Kein Modell verfügbar." };
    const json = tryParseJsonObject(extractAnthropicText(result.response));
    if (!json) return { ok: false, message: "Kein JSON vom Modell." };
    const parsed = aiChunkSchema.safeParse(json);
    if (!parsed.success) return { ok: false, message: "Ungültige Chunk-Struktur." };
    return {
      ok: true,
      model: result.model,
      step: {
        title: parsed.data.title?.trim() || input.titleHint,
        fields: parsed.data.fields,
      },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Chunk-Extraktion fehlgeschlagen.",
    };
  }
}

async function extractWholeDocument(input: {
  anthropic: Anthropic;
  models: string[];
  text: string;
  title?: string;
  timeoutMs: number;
}): Promise<
  | { ok: true; title: string; description: string; steps: AiStep[]; model: string }
  | { ok: false; message: string }
> {
  const system = [
    "Du extrahierst aus einem ausgefüllten Fragebogen (Rohtext, oft aus Word) strukturierte Fragen und Antworten.",
    "Gib NUR ein JSON-Objekt zurück (kein Markdown, keine Erklärung):",
    '{ "title": "...", "description": "...", "steps": [ { "title": "Abschnitt", "fields": [ { "title": "Frage", "description": "Hinweis", "type": "text|checkbox|ranking|radio", "answer": "Antworttext oder null", "options": [] } ] } ] }',
    "Regeln:",
    "- Erfinde keine Antworten. Wenn keine Antwort erkennbar ist: answer = null.",
    "- Behalte Antworttexte möglichst wörtlich.",
    "- Abschnitte anhand von Überschriften/Emojis/Nummerierung gruppieren.",
    "- type=checkbox bei Mehrfachauswahl; ranking bei nummerierten Prioritäten (1. 2. 3.); sonst text.",
    "- Jede erkennbare Frage aufnehmen — nichts Wichtiges weglassen.",
  ].join("\n");

  try {
    const result = await callAnthropicFirstAvailable({
      anthropic: input.anthropic,
      models: input.models,
      maxTokens: 12_000,
      timeoutMs: input.timeoutMs,
      stream: true,
      system,
      messages: [
        {
          role: "user",
          content: [
            input.title?.trim() ? `Gewünschter Titel: ${input.title.trim()}` : null,
            "Fragebogen-Rohtext:",
            "-----",
            input.text.slice(0, 40_000),
            "-----",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    if (!result) return { ok: false, message: "Kein verfügbares KI-Modell für den Import." };
    const json = tryParseJsonObject(extractAnthropicText(result.response));
    if (!json) return { ok: false, message: "KI-Antwort war kein gültiges JSON." };
    const parsed = aiExtractSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "KI-Struktur ungültig.",
      };
    }
    return {
      ok: true,
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      steps: parsed.data.steps,
      model: result.model,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "KI-Extraktion fehlgeschlagen.",
    };
  }
}

/**
 * Extract questions + answers from an arbitrary filled questionnaire paste.
 * Large docs are split into section chunks and processed in parallel (fast model first).
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
  const fastModels = resolveSurveyUtilityModels();
  const strongModels = resolveSurveyActionModels();
  const normalized = normalizeWordQuestionnaireText(input.text);
  const chunks = splitQuestionnaireIntoAiChunks(normalized);

  let title = input.title?.trim() || "";
  let description = "";
  let steps: AiStep[] = [];
  let modelUsed = "";

  const useChunking = chunks.length >= 2 || normalized.length > 8_000;

  if (!useChunking) {
    const whole = await extractWholeDocument({
      anthropic,
      models: [...fastModels, ...strongModels],
      text: normalized,
      title: input.title,
      timeoutMs: 180_000,
    });
    if (!whole.ok) return whole;
    title = input.title?.trim() || whole.title;
    description = whole.description;
    steps = whole.steps;
    modelUsed = whole.model;
  } else {
    const chunkResults = await mapPool(chunks, 3, async (chunk) =>
      extractOneChunk({
        anthropic,
        models: [...fastModels, ...strongModels],
        titleHint: chunk.title,
        body: chunk.body,
        timeoutMs: 75_000,
      }),
    );

    const okSteps: AiStep[] = [];
    const errors: string[] = [];
    for (let i = 0; i < chunkResults.length; i += 1) {
      const r = chunkResults[i]!;
      if (r.ok) {
        okSteps.push(r.step);
        modelUsed = modelUsed || r.model;
      } else {
        errors.push(`${chunks[i]!.title}: ${r.message}`);
      }
    }

    if (okSteps.length === 0) {
      const whole = await extractWholeDocument({
        anthropic,
        models: strongModels,
        text: normalized.slice(0, 35_000),
        title: input.title,
        timeoutMs: 240_000,
      });
      if (!whole.ok) {
        return {
          ok: false,
          message: `KI-Abschnitte fehlgeschlagen (${errors.slice(0, 3).join("; ")}). Gesamt: ${whole.message}`,
        };
      }
      title = input.title?.trim() || whole.title;
      description = whole.description;
      steps = whole.steps;
      modelUsed = whole.model;
    } else {
      steps = okSteps;
      title =
        input.title?.trim() ||
        chunks.find((c) => /persona|fragebogen|anbieter|wunschkunde/i.test(c.title))
          ?.title ||
        chunks[0]?.title ||
        "Importierter Fragebogen";
      if (errors.length > 0) {
        description = `Teilweise importiert — ${errors.length} Abschnitt(e) fehlgeschlagen.`;
      }
    }
  }

  steps = steps
    .map((s) => ({
      ...s,
      fields: s.fields.filter((f: AiField) => f.title.trim().length > 0),
    }))
    .filter((s) => s.fields.length > 0);

  if (steps.length === 0) {
    return { ok: false, message: "KI hat keine Fragen erkannt." };
  }

  const exportText = buildStrictExportFromSteps(title, description, steps);
  const converted = parseRawFilledQuestionnaire(exportText, { title });
  if (!converted.ok) {
    return { ok: false, message: converted.message };
  }

  return { ok: true, data: converted.data, model: modelUsed || "ai" };
}
