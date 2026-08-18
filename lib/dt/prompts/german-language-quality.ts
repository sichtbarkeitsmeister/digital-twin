/**
 * Shared German language-quality rules for DigitalTwin system prompts.
 * LLMs occasionally mix Du/Sie conjugation ("Sind du …") — make consistency explicit.
 */
export const DT_GERMAN_LANGUAGE_QUALITY_RULES = [
  "Schreibe korrektes, natürliches Deutsch: Grammatik, Flexion und Satzbau stimmen.",
  "Anrede konsequent: entweder durchgängig Du-Form (du bist, hast du, kannst du) ODER durchgängig Sie-Form (Sie sind, haben Sie, können Sie) — nie mischen.",
  "Niemals falsche Kombinationen wie „Sind du“, „Hast Sie“, „Bist Sie“, „Können du“.",
  "Vor dem Absenden kurz prüfen: Subjekt und Verb passen zusammen; keine Wortverdreher oder Kaputtsätze.",
].join("\n");

export function withGermanLanguageQuality(lines: string[]): string {
  return [...lines, "", "## Sprache & Grammatik", DT_GERMAN_LANGUAGE_QUALITY_RULES].join("\n");
}
