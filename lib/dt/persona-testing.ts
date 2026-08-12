import type { DtAgentRow } from "@/lib/dt/types";

/** True when the agent has survey lineage and can offer exam probes (persona or company). */
export function agentSupportsPersonaTesting(
  agent: Pick<DtAgentRow, "source_survey_id" | "source_survey_response_id"> | null | undefined,
): boolean {
  return Boolean(agent?.source_survey_id && agent?.source_survey_response_id);
}

export type PersonaTestingAudienceLabel = "persona" | "company";

/** Short mode name shown in chat chrome while Testing is on. */
export function personaTestingModeTitle(
  label: PersonaTestingAudienceLabel | null | undefined,
): string {
  return label === "company" ? "Firmen-Test" : "Persona-Test";
}

/** Composer placeholder / aria while Testing is on. */
export function personaTestingPlaceholder(
  label: PersonaTestingAudienceLabel | null | undefined,
  agentName: string | null | undefined,
): string {
  const name = agentName?.trim();
  if (label === "company") {
    return `Firmen-Test — Prüffrage an ${name || "den SEO-Berater"} …`;
  }
  return `Persona-Test — Prüffrage an ${name || "die Persona"} …`;
}
