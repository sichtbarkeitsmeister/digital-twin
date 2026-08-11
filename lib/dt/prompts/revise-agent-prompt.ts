/**
 * Revise an agent prompt (or avatar-specific append) from a natural-language instruction.
 */

export const AGENT_PROMPT_REVISE_SYSTEM = `Du bist ein Prompt-Editor für DigitalTwin-Persona-Agenten.

Der Nutzer gibt eine Änderungsanweisung. Du überarbeitest den gelieferten Prompt-Text entsprechend.

Regeln:
- Antworte NUR mit dem vollständigen überarbeiteten Prompt-Text (Markdown), kein Kommentar, kein JSON, kein Code-Fence.
- Behalte Struktur und Sprache (Deutsch), sofern die Anweisung nichts anderes verlangt.
- Persona-Ausrichtung: Interessent/Wunschkunde (Pre-Sale), kein Markenbotschafter, kein Mitarbeiter der Organisation — außer die Anweisung verlangt explizit etwas anderes oder der bestehende Text legt Bestandskunde fest.
- Erfinde keine neuen Firmenfakten (Website, 24/7, Umkreis, Zertifizierungen …), die nicht schon im Prompt stehen oder in der Anweisung gefordert werden.
- Ändere nur, was die Anweisung betrifft; Rest möglichst unverändert lassen.
- Keine {{platzhalter}} außer {{current_date}} / {{organisation}}, falls schon vorhanden.`;

export function buildAgentPromptReviseUserMessage(input: {
  agentName: string;
  agentRole?: string | null;
  target: "prompt" | "prompt_append";
  currentPrompt: string;
  instruction: string;
}): string {
  const targetLabel =
    input.target === "prompt_append"
      ? "avatar-spezifischer Teil (Zusätzliche Anweisungen)"
      : "System-/Basis-Prompt";

  return [
    `Agent: ${input.agentName}${input.agentRole?.trim() ? ` (${input.agentRole.trim()})` : ""}`,
    `Zieltext: ${targetLabel}`,
    "",
    "## Aktueller Text",
    input.currentPrompt.trim(),
    "",
    "## Änderungsanweisung",
    input.instruction.trim(),
    "",
    "Gib jetzt den vollständigen überarbeiteten Text aus.",
  ].join("\n");
}

/** Strip accidental markdown fences around a revised prompt. */
export function normalizeRevisedPromptText(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:markdown|md|text)?\s*/i, "").replace(/\s*```$/, "");
  }
  return text.trim();
}
