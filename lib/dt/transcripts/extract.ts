import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  coerceJsonObject,
  extractAnthropicText,
  extractToolUseInput,
  tryParseJsonObject,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { parseTranscriptExtractJson } from "@/lib/dt/transcripts/parse-extract";
import { DT_TRANSCRIPT_LLM_CHARS } from "@/lib/dt/transcripts/types";
import type { DtTranscriptExtract } from "@/lib/dt/transcripts/types";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";

const EXTRACT_TOOL_NAME = "submit_transcript_extract";

const EXTRACT_TOOL: Anthropic.Tool = {
  name: EXTRACT_TOOL_NAME,
  description: "Strukturierte Auswertung eines Kundeninterview-Transkripts für den DigitalTwin.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Kurzer Meeting-Titel (Kunde + Thema). Leer lassen, wenn unklar.",
      },
      summary: {
        type: "string",
        description: "4–8 Sätze auf Deutsch für Mitarbeitende.",
      },
      anbieterMarkdown: {
        type: "string",
        description:
          "Fakten über das UNTERNEHMEN des Kunden (Anbieterwissen) als Markdown-Stichpunkte.",
      },
      personas: {
        type: "array",
        description:
          "Wunschkunden / A-Mandate. Nur mehrere Einträge, wenn das Gespräch klar verschiedene Typen beschreibt.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            priority: { type: "string", enum: ["A", "B", "C"] },
            isPrimary: { type: "boolean" },
            description: { type: "string" },
            goals: { type: "string" },
            pains: { type: "string" },
            objections: { type: "string" },
            language: { type: "string" },
            buyingTriggers: { type: "string" },
            promptAppend: {
              type: "string",
              description: "Ich-Perspektive des Wunschkunden, authentisch, kein Markenbotschafter.",
            },
          },
          required: ["name", "description", "promptAppend"],
        },
      },
    },
    required: ["summary", "anbieterMarkdown", "personas"],
  },
};

const SYSTEM = `Du wertest ein Kundeninterview-Transkript für den DigitalTwin aus.
Nichts erfinden. Unterscheide strikt:

1) anbieterMarkdown = Fakten über das UNTERNEHMEN des Kunden (Anbieterwissen): Name, Leistungen, USPs, Region, Abläufe, Team, was sie nicht tun, Preise wenn genannt, Positionierung.
2) personas[] = Wunschkunden / A-Mandate des Unternehmens (Kundenwissen). Finde selbst heraus, ob es EINEN Typ gibt oder MEHRERE. A = idealer Wunschkunde/A-Mandat, B = relevant, C = Rand.

Regeln:
- Nur was im Transkript steht. Keine Website-Fantasie.
- Mehrere Personas nur, wenn das Gespräch klar verschiedene Kundentypen beschreibt.
- promptAppend: Ich-Perspektive des Wunschkunden, authentisch, kein Markenbotschafter, kein interner Jargon.
- summary: 4–8 Sätze auf Deutsch, für Mitarbeitende.
- title: kurzer Meeting-Titel (Kunde + Thema), sonst leer.
- Liefere die Auswertung ausschließlich über das Tool ${EXTRACT_TOOL_NAME}.
- Kein Markdown, keine Code-Fences, keine Trailing-Commas.`;

function buildUserMessage(input: {
  organisationName: string;
  filename?: string | null;
  text: string;
  compact: boolean;
}): string {
  const compactness = input.compact
    ? [
        "Zweite, kompakte Auswertung — die vorherige Antwort war unvollständig oder kein gültiges JSON.",
        "Halte anbieterMarkdown stichpunktartig (max. 12 Punkte).",
        "Höchstens 3 Personas. promptAppend: 6–10 Sätze je Persona.",
        "Kein Fließtext außerhalb des Tools.",
      ].join("\n")
    : [
        "promptAppend: 8–20 Sätze je Persona.",
        "anbieterMarkdown: vollständige, aber knappe Stichpunkte.",
      ].join("\n");

  return `Organisation: ${input.organisationName}
Datei: ${input.filename?.trim() || "ohne Dateiname"}

${compactness}

Transkript:
${input.text.slice(0, DT_TRANSCRIPT_LLM_CHARS)}`;
}

export function jsonFromTranscriptResponse(response: Anthropic.Messages.Message): unknown | null {
  const fromTool = coerceJsonObject(extractToolUseInput(response, EXTRACT_TOOL_NAME));
  if (fromTool) return fromTool;

  const namedTool = response.content.find(
    (item): item is Anthropic.ToolUseBlock => item.type === "tool_use",
  );
  const fromAnyTool = namedTool ? coerceJsonObject(namedTool.input) : null;
  if (fromAnyTool) return fromAnyTool;

  return tryParseJsonObject(extractAnthropicText(response));
}

export async function extractKnowledgeFromTranscript(input: {
  organisationName: string;
  filename?: string | null;
  text: string;
}): Promise<{
  extract: DtTranscriptExtract;
  usage: { inputTokens: number; outputTokens: number };
  model: string | null;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt.");
  }
  const body = input.text.trim();
  if (body.length < 80) {
    throw new Error("Transkript ist zu kurz für eine Auswertung.");
  }

  const anthropic = new Anthropic({ apiKey });
  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastModel: string | null = null;
  let lastError: Error | null = null;

  for (const compact of [false, true]) {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyActionModels(),
      maxTokens: compact ? 8_192 : 16_384,
      timeoutMs: 180_000,
      stream: true,
      system: SYSTEM,
      tools: [EXTRACT_TOOL],
      toolChoice: { type: "tool", name: EXTRACT_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: buildUserMessage({
            organisationName: input.organisationName,
            filename: input.filename,
            text: body,
            compact,
          }),
        },
      ],
    });

    if (!result) {
      lastError = new Error("Kein verfügbares Modell für die Transkript-Auswertung.");
      break;
    }

    lastModel = result.model;
    const roundUsage = sumAnthropicUsage(result.response.usage);
    usage.inputTokens += roundUsage.inputTokens;
    usage.outputTokens += roundUsage.outputTokens;

    const json = jsonFromTranscriptResponse(result.response);
    if (!json) {
      const raw = extractAnthropicText(result.response).slice(0, 400);
      console.warn("[dt/transcripts] extract JSON parse failed", {
        compact,
        stopReason: result.response.stop_reason,
        preview: raw,
      });
      lastError = new Error("Die KI-Antwort war kein gültiges JSON.");
      continue;
    }

    try {
      return {
        extract: parseTranscriptExtractJson(json),
        usage,
        model: lastModel,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err
          : new Error("Die Auswertung des Transkripts war unvollständig. Bitte erneut versuchen.");
      console.warn("[dt/transcripts] extract schema failed", {
        compact,
        stopReason: result.response.stop_reason,
        message: lastError.message,
      });
    }
  }

  throw lastError ?? new Error("Die KI-Antwort war kein gültiges JSON.");
}
