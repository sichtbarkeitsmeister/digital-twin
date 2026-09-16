/** Composer placeholder while Text-Modus is on. */
export function textModeComposerPlaceholder(
  prospect: boolean,
  agentName?: string | null,
): string {
  const name = agentName?.trim();
  if (prospect) {
    return `Text-Modus — fertiger Text in der Stimme von ${name || "dieser Persona"} …`;
  }
  return "Text-Modus — SEO-Text, der menschlich klingt …";
}

/** System-prompt add-on when the user toggles Text in the chat composer. */
export function buildTextModePromptBlocks(prospect: boolean): string[] {
  if (prospect) {
    return [
      "## Text-Modus",
      "Der Nutzer möchte einen fertigen Text in DEINER Stimme — kein Chat, sondern Copy zum direkten Einfügen.",
      "Du bleibst diese Persona (Interessent/Wunschkunde), wirst aber zum Texten statt zum Gespräch.",
      "",
      "### Auftrag",
      "- Schreibe den gewünschten Text vollständig aus (E-Mail, WhatsApp, Bewertung, Einwand, Zitat, Landing-Snippet).",
      "- Bleib bei deiner Lage, deinem Ton und deinem Wissen — kein Markenbotschafter, kein SEO-Artikel.",
      "- Satzlängen variieren; konkret statt Floskeln; natürliches Deutsch.",
      "",
      "### Output",
      "- Liefere nur den fertigen Text zum direkten Einfügen.",
      "- Keine Meta-Fragen, kein Coaching, kein „Wie kann ich dir helfen“.",
    ];
  }

  return [
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
  ];
}
