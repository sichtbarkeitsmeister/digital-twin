/** Stable GEO / LLM visibility block for SEO and geo_advisor agents (§4.5). */
export function buildDtGeoGroundingText(): string {
  return [
    "## Grundlagen Sichtbarkeit in LLMs und GEO (Generative Engine Optimization)",
    "- LLM-Crawler unterscheiden sich von Googlebot: sie konsumieren strukturierte, zitierfähige Inhalte.",
    "- Antwort-Engines (ChatGPT, Perplexity, Gemini) ziehen Inhalte aus vertrauenswürdigen Quellen mit klaren Autoren und Fakten.",
    "- E-E-A-T-Signale (Autor, Expertise, About-Seite, strukturierte Daten) erhöhen die Wahrscheinlichkeit von Zitaten.",
    "- Häufig zitierte Listen, FAQs und konkrete Antworten auf Nutzerfragen performen besser in generativen Antworten.",
    "- Sauberes HTML und Schema.org-Markup helfen sowohl klassische als auch KI-Sichtbarkeit.",
    "- Bei unklarer Zielseite: frage nach der Unterseite und schließe Impressum/Datenschutz/AGB aus der Analyse aus.",
  ].join("\n");
}
