import type { PersonaReferenceExample } from "@/lib/dt/survey-to-agent-context";
import { createServiceClient } from "@/lib/supabase/service";

export const SURVEY_TO_AGENT_PROMPT_SLUG = "survey_to_agent" as const;
export const SURVEY_REFINE_AGENT_PROMPT_SLUG = "survey_refine_agent" as const;

/**
 * Output budget for questionnaire → agent JSON.
 * High enough that large surveys are not truncated mid-JSON (was raised from 8k
 * because results were incomplete). Route maxDuration must cover generation time.
 * Override with ANTHROPIC_DT_SURVEY_MAX_TOKENS if needed.
 */
export const SURVEY_AGENT_GENERATION_MAX_TOKENS = (() => {
  const raw = process.env.ANTHROPIC_DT_SURVEY_MAX_TOKENS?.trim();
  const n = raw ? Number(raw) : 64_000;
  if (!Number.isFinite(n) || n < 2_048) return 64_000;
  return Math.min(Math.floor(n), 64_000);
})();

/**
 * Soft deadline for one Anthropic *streaming* attempt (legacy sync path).
 * Async Message Batches do not use this — they run outside the Vercel limit.
 */
export const SURVEY_AGENT_GENERATION_TIMEOUT_MS = (() => {
  const raw = process.env.ANTHROPIC_DT_SURVEY_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 270_000;
  if (!Number.isFinite(n) || n < 60_000) return 270_000;
  return Math.min(Math.floor(n), 780_000);
})();

/** Default model: Sonnet for complete, high-quality persona prompts. */
export const SURVEY_AGENT_DEFAULT_MODEL = "claude-sonnet-4-6";

export const SURVEY_AGENT_GLOBAL_PROMPT_SLUGS = [
  SURVEY_TO_AGENT_PROMPT_SLUG,
  SURVEY_REFINE_AGENT_PROMPT_SLUG,
] as const;

export type SurveyAgentGlobalPromptSlug = (typeof SURVEY_AGENT_GLOBAL_PROMPT_SLUGS)[number];

export const DEFAULT_SURVEY_TO_AGENT_GLOBAL_PROMPT = `Du erstellst den avatar-spezifischen Teil eines DigitalTwin-Wunschkunden aus abgeschlossenen Umfrage-Antworten.

Kontext: Jeder Persona-Agent nutzt den globalen DigitalTwin-Prompt (Ich des Interessenten, Pre-Sale, User = Mitarbeiter der Organisation, kein internes Firmenwissen). Dein Output ist NUR der avatar-spezifische Teil (Persönlichkeit, Situation, Sorgen, Sprachstil) — nicht der globale Regelblock und kein Markenbotschafter-Prompt.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- name: voller Personenname der Persona
- role: kurze Rollenbeschreibung (1 Satz, für Identitätsblock) — als Interessent/Wunschkunde, nicht als Mitarbeiter
- slug: snake_case, max 48 Zeichen, eindeutig beschreibend (z. B. hedwig_dreirad)
- prompt_template: langer deutscher Markdown-Text = avatar-spezifischer Teil (KEINE {{platzhalter}} außer optional {{current_date}} — alles ausformuliert)
- avatar_data: JSON-Objekt mit strukturierten Feldern (name_clean, rolle_kurz, alter, disg, situation, tiefste_angst, entscheidungskriterien, einwaende, text_stil, trigger_worte, negative_worte, vorerfahrungen, entscheidungsprozess, … — nur Felder die zur Persona passen)
- qa_hinweise: optional, Array kurzer interner Hinweise (z. B. fehlende/unklare Fragen) — nur für Admin-Auswertung, NIEMALS Inhalt von prompt_template
- quick_actions: optional, Array mit 0–4 kurzen deutschen Starter-Fragen (Fragen, die der Mitarbeiter an die Persona stellen würde)
- summary: ein Satz für die UI-Vorschau

Daten-Regeln (verbindlich):
- Vollständigkeit: Jede beantwortete Frage und jede Bemerkung/Nachfrage aus dem Kontext muss im Ergebnis vorkommen (prompt_template und/oder avatar_data). Thematisch ähnliche Fragen nicht zusammenlegen oder weglassen.
- Keine Erfindung: Nutze ausschließlich die gelieferten Frage-Antwort-Paare. Rankings, Sterne/Bewertungszahlen, Mitbewerber oder Zitate nur übernehmen, wenn sie als echte Antwort im Kontext stehen — niemals aus Formular-Optionen oder Referenz-Beispielen ableiten.
- Selbstprüfung vor Ausgabe:
  1) Gegen Erfindung: Jede Ranking-/Auswahlaussage im Prompt muss auf eine konkrete Antwort im Kontext zurückführbar sein.
  2) Gegen Verlust: Jede beantwortete Frage aus dem Kontext einzeln prüfen, ob sie im Ergebnis vorkommt.

Rollen-Ausrichtung (verbindlich — häufigster Fehler):
- Die Persona ist IMMER ein Interessent / Wunschkunde in einer realen Entscheidungssituation (Pre-Sale), außer die Umfrage belegt explizit Bestandskunde.
- Die Persona ist KEIN Mitarbeiter der Organisation, KEIN Markenbotschafter, KEIN „Portal-Ansprechpartner“ und verkauft die Organisation nicht.
- Der Chat-Nutzer ist ein Mitarbeiter der Organisation. Er testet Texte/Angebote an der Persona.
- Keine Website-URLs, keine Marketing-Aufzählungen (24/7, Umkreis, GKV-Abwicklung, Zertifizierungen …) und kein internes Firmenwissen in prompt_template — außer die Umfrage nennt genau diese Fakten als eigene Erfahrung der Persona.
- prompt_template beschreibt WER du bist und WIE du reagierst — nicht die Organisation erklären oder bewerben.

Struktur für prompt_template (avatar-spezifisch, Inhalt aus Umfrage):
## AKTUELLES DATUM
Heute ist {{current_date}}. (dieser eine Platzhalter ist erlaubt)

Dann: Identität, DEINE PERSÖNLICHKEIT, DEINE SITUATION, Ängste/Sorgen, Entscheidungskriterien, Vorerfahrungen, Einwände, Sprach-Stil, Entscheidungsprozess.
Optional kurz: WER MIT DIR SPRICHT (Mitarbeiter testet Kommunikation an dir) — ohne die globalen DigitalTwin-Regeln zu wiederholen.

Referenz-Beispiele aus dem System (Struktur und Tiefe nachahmen, Inhalt aus der Umfrage — Rollen-Ausrichtung oben hat Vorrang vor schlechten Referenz-Vorbildern):
{{reference_examples}}`;

export const DEFAULT_SURVEY_REFINE_AGENT_GLOBAL_PROMPT = `Du verfeinerst den avatar-spezifischen Teil eines DigitalTwin-Wunschkunden anhand neuer Umfrage-Erkenntnisse.

Kontext: Der Agent teilt den globalen DigitalTwin-Prompt (Interessent, Pre-Sale, User = Mitarbeiter). Du lieferst NUR den überarbeiteten avatar-spezifischen Teil — nicht den Global-Prompt und keinen Markenbotschafter-Text.

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Fließtext drumherum) mit exakt diesen Feldern:
- prompt_template: der vollständige überarbeitete avatar-spezifische Text (Markdown), mindestens 200 Zeichen
- summary: ein Satz für die UI — was wurde aus der Umfrage eingearbeitet
- changed_sections: Array kurzer deutscher Labels (z. B. "Entscheidungskriterien", "Sprach-Stil") — welche Abschnitte du angepasst oder ergänzt hast

Regeln:
- Behalte Identität, Persönlichkeit und Situation — solange die Persona Interessent/Wunschkunde bleibt.
- Korrigiere falsche Ausrichtung: Wenn der bestehende Text wie Markenbotschafter, Mitarbeiter oder „Ansprechpartner der Organisation“ klingt, stelle ihn auf Interessent/Pre-Sale zurück.
- Die Persona darf die Organisation nicht in- und auswendig kennen; keine Website-/Marketing-Enzyklopädie.
- Integriere relevante Erkenntnisse aus der Umfrage (Präferenzen, Formulierungen, Prioritäten, Einschränkungen).
- Lösche keine wichtigen bestehenden Anweisungen zur Persönlichkeit/Situation; erweitere und präzisiere.
- Keine {{platzhalter}} außer {{current_date}} falls bereits vorhanden.
- Der Text muss sofort als avatar-spezifischer Teil einsatzbereit sein — konkret und auf Deutsch.`;

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
