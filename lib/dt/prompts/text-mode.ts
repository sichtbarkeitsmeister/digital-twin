import type { SupabaseClient } from "@supabase/supabase-js";

/** Default instructions injected while the chat Text toggle is on. */
export const DT_DEFAULT_TEXT_MODE_INSTRUCTIONS = [
  "## Text-Modus",
  "Der Nutzer möchte SEO-optimierte, publikationsreife Texte — kein Chat, sondern fertiger Copy-Output.",
  "",
  "### SEO",
  "- Fokus-Keyword und semantische Varianten natürlich einweben (Titel, erster Absatz, H2/H3).",
  "- Suchintention treffen; scannbare Struktur mit klaren Zwischenüberschriften.",
  "- Bei Bedarf Meta-Titel, Meta-Description und interne Verlinkungsvorschläge klar getrennt anbieten.",
  "- Kein Keyword-Stuffing, keine künstliche Wiederholung.",
  "",
  "### Menschlicher Ton (Anti-AI-Slop)",
  "- Satzlängen und Rhythmus variieren; aktiv formulieren, konkrete Details statt Füllwörter.",
  "- Vermeide Floskeln wie „in der heutigen schnelllebigen Welt“, „darüber hinaus“, „zudem“, „es ist wichtig zu beachten“.",
  "- Kein leerer Schlussabsatz, kein Em-Dash-Overuse, natürliches Deutsch.",
  "",
  "### Output",
  "- Liefere den fertigen Text zum direkten Einfügen.",
  "- Meta-/Titel-Vorschläge klar abtrennen, wenn du sie mitlieferst.",
].join("\n");

export function resolveTextModeInstructions(
  stored: string | null | undefined,
): string {
  const trimmed = stored?.trim() ?? "";
  return trimmed || DT_DEFAULT_TEXT_MODE_INSTRUCTIONS;
}

export function isDefaultTextModeInstructions(value: string | null | undefined): boolean {
  return resolveTextModeInstructions(value) === DT_DEFAULT_TEXT_MODE_INSTRUCTIONS;
}

export async function loadTextModeInstructions(
  supabase: SupabaseClient,
): Promise<{ prompt: string; isDefault: boolean; stored: string | null }> {
  const { data, error } = await supabase
    .from("dt_platform_settings")
    .select("text_mode_prompt")
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    console.warn("[dt/text-mode] load:", error.message);
    return {
      prompt: DT_DEFAULT_TEXT_MODE_INSTRUCTIONS,
      isDefault: true,
      stored: null,
    };
  }
  const stored =
    typeof data?.text_mode_prompt === "string" ? data.text_mode_prompt : null;
  const prompt = resolveTextModeInstructions(stored);
  return {
    prompt,
    isDefault: isDefaultTextModeInstructions(stored),
    stored: stored?.trim() ? stored : null,
  };
}
