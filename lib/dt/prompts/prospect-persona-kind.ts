/**
 * Interviewed prospect (Wunschkunde / Umfrage-Persona / Default-DigitalTwin).
 * Not staff/SEO voice — matches the global DigitalTwin Wunschkunden-Prompt.
 * A module of its own so client code (Agenten, Mix) can use it without the prompt builder.
 */
export function isProspectPersonaKind(
  kind?: string | null,
  _slug?: string | null,
): boolean {
  void _slug;
  return kind === "wunschkunde" || kind === "persona";
}
