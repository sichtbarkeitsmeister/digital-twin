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
  fallbackSuggestAudienceVocab,
  parseAudienceVocabSuggestionPayload,
  type AudienceVocabSuggestion,
} from "@/lib/surveys/suggest-audience-vocab";

const SYSTEM =
  "Du wählst deutsche Fragebogen-Wortwahl für eine Branche. Antworte nur mit einem JSON-Objekt, ohne Markdown.";

function suggestionPrompt(input: {
  industry: string;
  organisationName: string;
  services: string[];
}): string {
  const services =
    input.services.length > 0
      ? input.services.map((s) => `- ${s}`).join("\n")
      : "(keine)";
  return `Branche / Gewerk: ${input.industry || "(nicht angegeben)"}
Firmenname: ${input.organisationName || "(nicht angegeben)"}
Leistungen:
${services}

Wähle Wörter, die in Fragen, Beispielen und Checkboxen stehen. Ein Substantiv je Feld, Nominativ, keine Sätze.
kind:
- kanzlei: Recht, Steuer, Notar → Mandant / Mandat
- praxis: Medizin, Therapie, Heilkunde → Patient / Behandlung
- handwerk: Handwerk, Bau, Entrümpelung, Umzug, Reinigung → Kunde + konkrete Arbeit (Umzug, Entrümpelung, Auftrag)
- unternehmen: übrige Dienstleister, Gastro, Agentur

business = der Betrieb (Kanzlei, Praxis, Betrieb, Umzugsunternehmen, Firma, …)
singular = die Person (Mandant, Patient, Kunde, Gast, …)
engagement = die Arbeit (Mandat, Behandlung, Auftrag, Umzug, Entrümpelung, Buchung, …)
project / booking analog, oft gleich engagement oder Termin/Buchung/Projekt.
Gender muss zum Artikel passen (die Entrümpelung = f, der Umzug = m, das Umzugsunternehmen = n).

{
  "kind": "handwerk",
  "label": "Entrümpelung",
  "hint": "kurz",
  "note": "ein Satz warum",
  "business": "Betrieb",
  "businessPlural": "Betriebe",
  "businessGender": "m",
  "singular": "Kunde",
  "plural": "Kunden",
  "engagement": "Entrümpelung",
  "engagementPlural": "Entrümpelungen",
  "engagementGender": "f",
  "project": "Räumung",
  "projectPlural": "Räumungen",
  "projectGender": "f",
  "booking": "Auftrag",
  "bookingPlural": "Aufträge",
  "bookingGender": "m"
}`;
}

async function aiSuggestAudienceVocab(input: {
  industry?: string | null;
  organisationName?: string | null;
  services?: string[] | null;
}): Promise<AudienceVocabSuggestion | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const industry = (input.industry ?? "").trim();
  const organisationName = (input.organisationName ?? "").trim();
  const services = (input.services ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!industry && !organisationName && services.length === 0) return null;

  const anthropic = new Anthropic({ apiKey });
  try {
    const result = await callAnthropicFirstAvailable({
      anthropic,
      models: resolveSurveyUtilityModels(),
      maxTokens: 700,
      timeoutMs: 20_000,
      stream: false,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: suggestionPrompt({ industry, organisationName, services }),
        },
      ],
    });
    if (!result) return null;
    const raw = extractAnthropicText(result.response);
    const jsonText = extractFirstJsonObject(escapeControlCharsInJsonStrings(raw));
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText) as unknown;
    const payload = parseAudienceVocabSuggestionPayload(parsed);
    if (!payload) return null;
    return {
      vocab: payload.vocab,
      source: "ai",
      industry: industry || organisationName,
      note: payload.note || `KI-Vorschlag für ${payload.vocab.label}. Felder kannst du noch anpassen.`,
    };
  } catch {
    return null;
  }
}

export async function resolveAudienceVocabSuggestion(input: {
  industry?: string | null;
  organisationName?: string | null;
  services?: string[] | null;
}): Promise<AudienceVocabSuggestion> {
  const ai = await aiSuggestAudienceVocab(input);
  if (ai) return ai;

  const fallback = fallbackSuggestAudienceVocab(input);
  const suffix = process.env.ANTHROPIC_API_KEY?.trim()
    ? "KI-Vorschlag nicht verfügbar — Vorschlag aus der Branche."
    : "KI nicht konfiguriert — Vorschlag aus der Branche.";
  return { ...fallback, note: `${fallback.note} ${suffix}` };
}
