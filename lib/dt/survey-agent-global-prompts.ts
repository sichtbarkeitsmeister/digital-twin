import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";

export const SURVEY_TO_AGENT_PROMPT_SLUG = "survey_to_agent" as const;
export const SURVEY_REFINE_AGENT_PROMPT_SLUG = "survey_refine_agent" as const;

export const SURVEY_AGENT_GLOBAL_PROMPT_SLUGS = [
  SURVEY_TO_AGENT_PROMPT_SLUG,
  SURVEY_REFINE_AGENT_PROMPT_SLUG,
] as const;

export type SurveyAgentGlobalPromptSlug = (typeof SURVEY_AGENT_GLOBAL_PROMPT_SLUGS)[number];

export const DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT = `Du erstellst DigitalTwin-Persona-Agenten für B2B-Kunden aus abgeschlossenen Umfrage-Antworten.

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
{{reference_examples}}`;

export const DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT = `Du verfeinerst einen bestehenden DigitalTwin-Agenten-Prompt anhand neuer Umfrage-Erkenntnisse.

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

const REFERENCE_EXAMPLES_PLACEHOLDER = /\{\{\s*reference_examples\s*\}\}/gi;

const DEFAULTS: Record<SurveyAgentGlobalPromptSlug, string> = {
  [SURVEY_TO_AGENT_PROMPT_SLUG]: DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT,
  [SURVEY_REFINE_AGENT_PROMPT_SLUG]: DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT,
};

export function buildSurveyReferenceBlock(examples: PersonaReferenceExample[]): string {
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

export function resolveSurveyToAgentSystemPrompt(
  globalPrompt: string,
  examples: PersonaReferenceExample[],
): string {
  const referenceBlock = buildSurveyReferenceBlock(examples);
  if (/\{\{\s*reference_examples\s*\}\}/i.test(globalPrompt)) {
    return globalPrompt.replace(REFERENCE_EXAMPLES_PLACEHOLDER, referenceBlock);
  }

  return `${globalPrompt.trim()}\n\nReferenz-Beispiele aus dem System (Struktur und Tiefe nachahmen, Inhalt aus der Umfrage):\n${referenceBlock}`;
}

export async function loadSurveyAgentGlobalPrompt(
  slug: SurveyAgentGlobalPromptSlug,
): Promise<string> {
  const fallback = DEFAULTS[slug];

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("dt_agent_templates")
      .select("default_prompt")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.warn(`[dt] loadSurveyAgentGlobalPrompt(${slug}):`, error.message);
      return fallback;
    }

    const prompt = data?.default_prompt?.trim();
    return prompt || fallback;
  } catch (err) {
    console.warn(`[dt] loadSurveyAgentGlobalPrompt(${slug}):`, err);
    return fallback;
  }
}
