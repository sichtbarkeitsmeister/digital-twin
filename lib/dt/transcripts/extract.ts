import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  escapeControlCharsInJsonStrings,
  extractAnthropicText,
  extractFirstJsonObject,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyActionModels } from "@/lib/ai/survey-model-config";
import { parseTranscriptExtractJson } from "@/lib/dt/transcripts/parse-extract";
import { DT_TRANSCRIPT_LLM_CHARS } from "@/lib/dt/transcripts/types";
import type { DtTranscriptExtract } from "@/lib/dt/transcripts/types";
import { sumAnthropicUsage } from "@/lib/dt/record-llm-usage";

const SYSTEM = `Du wertest ein Kundeninterview-Transkript für den DigitalTwin aus.
Nur JSON, nichts erfinden. Unterscheide strikt:

1) anbieterMarkdown = Fakten über das UNTERNEHMEN des Kunden (Anbieterwissen): Name, Leistungen, USPs, Region, Abläufe, Team, was sie nicht tun, Preise wenn genannt, Positionierung.
2) personas[] = Wunschkunden / A-Mandate des Unternehmens (Kundenwissen). Finde selbst heraus, ob es EINEN Typ gibt oder MEHRERE. A = idealer Wunschkunde/A-Mandat, B = relevant, C = Rand.

Regeln:
- Nur was im Transkript steht. Keine Website-Fantasie.
- Mehrere Personas nur, wenn das Gespräch klar verschiedene Kundentypen beschreibt.
- promptAppend: Ich-Perspektive des Wunschkunden, 8–20 Sätze, authentisch, kein Markenbotschafter, kein interner Jargon.
- summary: 4–8 Sätze auf Deutsch, für Mitarbeitende.
- title: kurzer Meeting-Titel (Kunde + Thema), sonst null.`;

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
  const result = await callAnthropicFirstAvailable({
    anthropic,
    models: resolveSurveyActionModels(),
    maxTokens: 8_192,
    timeoutMs: 120_000,
    stream: true,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Organisation: ${input.organisationName}
Datei: ${input.filename?.trim() || "ohne Dateiname"}

Transkript:
${body.slice(0, DT_TRANSCRIPT_LLM_CHARS)}

Antworte nur mit JSON:
{
  "title": "…",
  "summary": "…",
  "anbieterMarkdown": "## Unternehmen\\n- …",
  "personas": [
    {
      "name": "Vorname Nachname oder Typbezeichnung",
      "role": "Rolle / Lebenssituation",
      "priority": "A",
      "isPrimary": true,
      "description": "3–6 Sätze",
      "goals": "…",
      "pains": "…",
      "objections": "…",
      "language": "…",
      "buyingTriggers": "…",
      "promptAppend": "Ich-Text als dieser Wunschkunde…"
    }
  ]
}`,
      },
    ],
  });

  if (!result) {
    throw new Error("Kein verfügbares Modell für die Transkript-Auswertung.");
  }

  const raw = extractAnthropicText(result.response);
  const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
  if (!jsonText) {
    throw new Error("Die KI hat keine auswertbare JSON-Antwort geliefert.");
  }
  let json: unknown;
  try {
    json = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error("Die KI-Antwort war kein gültiges JSON.");
  }

  return {
    extract: parseTranscriptExtractJson(json),
    usage: sumAnthropicUsage(result.response.usage),
    model: result.model,
  };
}
