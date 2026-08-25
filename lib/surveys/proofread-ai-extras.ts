import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  callAnthropicFirstAvailable,
  extractAnthropicText,
  extractFirstJsonObject,
  escapeControlCharsInJsonStrings,
} from "@/lib/ai/anthropic-helpers";
import { resolveSurveyUtilityModels } from "@/lib/ai/survey-model-config";
import {
  extraGapHints,
  parseAiExtraQuestions,
  type AiExtraQuestion,
} from "@/lib/surveys/ai-extra-questions";
import type { ClientAudienceVocab } from "@/lib/surveys/client-audience";

/**
 * Second pass: drop illogical extras and fix German spelling/grammar.
 * If the model fails, the draft extras are kept.
 */
export async function proofreadAiExtraQuestions(input: {
  extras: AiExtraQuestion[];
  vocab: ClientAudienceVocab;
  organisationName: string;
  services: string[];
  coreTitles: string[];
  max?: number;
}): Promise<AiExtraQuestion[]> {
  const draft = input.extras.filter((row) => row.title.trim().length >= 12);
  if (draft.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return draft;

  const max = input.max ?? draft.length;
  const anthropic = new Anthropic({ apiKey });
  const services =
    input.services.length > 0
      ? input.services.map((s) => `- ${s}`).join("\n")
      : "(keine erkannt)";
  const core = input.coreTitles.map((t) => `- ${t}`).join("\n");

  try {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyUtilityModels(),
      maxTokens: 900,
      timeoutMs: 15_000,
      stream: false,
      system:
        "Du prüfst deutsche Fragebogen-Fragen. Nur JSON. Keine Markdown. Korrigiere Sprache, streiche Unlogisches.",
      messages: [
        {
          role: "user",
          content: `Firma: ${input.organisationName}
Art: ${input.vocab.label} (${input.vocab.business} / ${input.vocab.singular} / ${input.vocab.engagement})
${extraGapHints(input.vocab.kind)}

Leistungen:
${services}

Schon im Fragebogen (nicht wiederholen):
${core}

Entwurf:
${JSON.stringify(draft, null, 2)}

Prüfe jede Frage:
1. Logik: passt sie zu DIESER Firma und diesen Leistungen? Streiche branchenfremde oder doppelte Fragen.
2. Rechtschreibung und Grammatik: Artikel, Genus, Numerus, Kommas, keine Wortkleberei (nicht „RegionHyaluronsäure“, nicht „jedem Behandlung“).
3. description: ein kurzer Grund plus ein passendes Antwort-Beispiel. Wortwahl ${input.vocab.singular}/${input.vocab.engagement}.

Behalte höchstens ${max} Fragen. Wenn eine Frage nur sprachlich falsch ist, korrigiere sie statt zu streichen.

{"questions":[{"title":"...","description":"..."}]}`,
        },
      ],
    });
    if (!result) return draft;
    const raw = extractAnthropicText(result.response);
    const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
    if (!jsonText) return draft;
    const parsed = JSON.parse(jsonText) as { questions?: unknown };
    const cleaned = parseAiExtraQuestions(parsed.questions, {
      max,
      existingTitles: input.coreTitles,
    });
    return cleaned.length > 0 ? cleaned : draft;
  } catch {
    return draft;
  }
}
