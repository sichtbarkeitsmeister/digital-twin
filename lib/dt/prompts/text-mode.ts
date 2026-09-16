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
