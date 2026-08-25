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

export async function generateAiExtraQuestions(input: {
  vocab: ClientAudienceVocab;
  organisationName: string;
  purpose: "persona" | "anbieter" | "intern";
  services: string[];
  coreTitles: string[];
  crawlSummary?: string | null;
  meetingContext?: string | null;
  documentText?: string | null;
  max?: number;
}): Promise<AiExtraQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return [];

  const max = input.max ?? 4;
  const vocab = input.vocab;
  const anthropic = new Anthropic({ apiKey });
  const services =
    input.services.length > 0
      ? input.services.map((s) => `- ${s}`).join("\n")
      : "(keine erkannt)";
  const docs = input.documentText?.trim()
    ? `\nDateien:\n${input.documentText.trim().slice(0, 2500)}\n`
    : "";
  const meeting = input.meetingContext?.trim()
    ? `\nBriefing:\n${input.meetingContext.trim().slice(0, 2000)}\n`
    : "";
  const crawl = (input.crawlSummary ?? "").trim().slice(0, 5000) || "(kein Crawl)";

  try {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyUtilityModels(),
      maxTokens: 1200,
      timeoutMs: 20_000,
      stream: false,
      system:
        "Du erfindest deutsche Zusatzfragen für einen Fragebogen. Nur JSON. Grammatik prüfen. Nichts aus der falschen Branche.",
      messages: [
        {
          role: "user",
          content: `Firma: ${input.organisationName}
Zweck: ${input.purpose}
Art: ${vocab.label} — ${vocab.business} / ${vocab.singular} / ${vocab.engagement}
${extraGapHints(vocab.kind)}

Leistungen:
${services}
${docs}${meeting}
Website/Crawl:
${crawl}

Schon gefragt (NICHT wiederholen):
${input.coreTitles.map((t) => `- ${t}`).join("\n")}

Liefere genau ${max} konkrete Fragen zu Lücken DIESES Anbieters. Nie ein leeres questions-Array. Wenn die Website wenig hergibt, typische Lücken dieser Art von ${vocab.business} trotzdem stellen — mit Antwort-Beispiel. title = die Frage, description = warum + ein Antwort-Beispiel mit ${vocab.singular}/${vocab.engagement}. Korrektes Deutsch.

{"questions":[{"title":"...","description":"..."}]}`,
        },
      ],
    });
    if (!result) return [];
    const raw = extractAnthropicText(result.response);
    const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
    if (!jsonText) return [];
    const parsed = JSON.parse(jsonText) as { questions?: unknown };
    return parseAiExtraQuestions(parsed.questions, {
      max,
      existingTitles: input.coreTitles,
    });
  } catch {
    return [];
  }
}

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
