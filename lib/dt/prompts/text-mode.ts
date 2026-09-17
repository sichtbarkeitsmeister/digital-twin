import type { SupabaseClient } from "@supabase/supabase-js";

/** Default instructions injected while the chat Text toggle is on. */
export const DT_DEFAULT_TEXT_MODE_INSTRUCTIONS = [
  "## Text-Modus (hat Vorrang)",
  "Der Nutzer ist ein Kunde der Organisation und will fertige Texte zum direkten Verwenden — kein Chat, keine SEO-Optimierung, keine Meta-Titel.",
  "Typische Aufträge: Flyer, Social-Media-Posts, Kundeninfos, Website-Absätze, E-Mails, Aushänge, WhatsApp-Nachrichten.",
  "",
  "### Rolle",
  "Verlasse jetzt die Gesprächs-Persona (auch als Wunschkunde/Interessent). Du schreibst die Texte für den Nutzer, nicht als der Charakter im Rollenspiel.",
  "Persona-Wissen darfst du als Tonfall- und Faktenquelle nutzen, wenn es zum Auftrag passt — aber du bleibst nicht in der Kundenrolle und lehnst das Schreiben nicht ab.",
  "",
  "### Stil",
  "- Klar, konkret, menschlich. Satzlängen variieren, aktiv formulieren.",
  "- Keine KI-Floskeln („in der heutigen schnelllebigen Welt“, „darüber hinaus“, „es ist wichtig zu beachten“).",
  "- Kein Keyword-Stuffing, keine Suchmaschinen-Optimierung, außer der Nutzer bittet ausdrücklich darum.",
  "",
  "### Output",
  "- Liefere den fertigen Text zum Kopieren.",
  "- Wenn Format unklar ist, nimm das Nächstliegende (z. B. Post, Flyer-Fließtext, kurze Info) und schreib los.",
].join("\n");

/** Previous SEO-focused default — treat as unset so saved copies pick up the new wording. */
export const DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS = [
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

function normalizeTextModePrompt(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function resolveTextModeInstructions(
  stored: string | null | undefined,
): string {
  const trimmed = normalizeTextModePrompt(stored ?? "");
  if (!trimmed || trimmed === normalizeTextModePrompt(DT_LEGACY_SEO_TEXT_MODE_INSTRUCTIONS)) {
    return DT_DEFAULT_TEXT_MODE_INSTRUCTIONS;
  }
  return trimmed;
}

export function isDefaultTextModeInstructions(value: string | null | undefined): boolean {
  const resolved = resolveTextModeInstructions(value);
  return resolved === DT_DEFAULT_TEXT_MODE_INSTRUCTIONS;
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
