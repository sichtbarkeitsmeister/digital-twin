/**
 * The saved Anbieterstand as Markdown: what the SEO-Berater receives on approval and what
 * Transkripte offers as a download. Pure and free of Node APIs, so the browser can use it.
 */

import type { AnbieterItem } from "@/lib/dt/transcripts/workshop-model";

function claimOrigin(claim: { source: string; newest: boolean }): string {
  return [claim.source, claim.newest ? "neuere Quelle" : ""].filter(Boolean).join(", ");
}

/** Unresolved contradictions travel with the point: both claims, none chosen. */
function conflictLines(item: Pick<AnbieterItem, "conflicts">): string[] {
  return (item.conflicts ?? []).flatMap((conflict) => [
    "",
    `Ungeklärter Widerspruch${conflict.topic ? ` (${conflict.topic})` : ""}. Keine der Angaben als gesichert verwenden:`,
    ...conflict.claims.map((claim) => `- ${claim.text} (${claimOrigin(claim)})`),
  ]);
}

export function buildCurrentAnbieterMarkdown(input: {
  organisationName: string;
  items: Pick<AnbieterItem, "label" | "current" | "conflicts">[];
}): string {
  const filled = input.items.filter((item) => item.current.trim());
  const open = input.items.filter((item) => !item.current.trim());
  const lines = [
    `Organisation: ${input.organisationName}`,
    "Dies ist der aktuelle Stand aus allen Workshops und Gesprächen.",
    "Spätere Aussagen haben frühere zum selben Punkt ersetzt. Nur diesen Stand verwenden. Nichts ergänzen, was hier nicht steht.",
    "",
  ];
  for (const item of filled) {
    lines.push(`## ${item.label}`, item.current.trim(), ...conflictLines(item), "");
  }
  const openWithConflicts = open.filter((item) => (item.conflicts ?? []).length > 0);
  for (const item of openWithConflicts) {
    lines.push(`## ${item.label}`, ...conflictLines(item), "");
  }
  const unproven = open.filter((item) => (item.conflicts ?? []).length === 0);
  if (unproven.length > 0) {
    lines.push(
      "## Noch offen",
      "Diese Punkte wurden nicht belegt. Nicht erfinden:",
      ...unproven.map((item) => `- ${item.label}`),
    );
  }
  return lines.join("\n").trim();
}

/**
 * Whether the card „1. Anbieter“ shows the saved points: as soon as any point has text, in
 * every status, also „Veraltet“ after a conversation was added or changed.
 */
export function anbieterHasSavedPoints(items: Pick<AnbieterItem, "current">[]): boolean {
  return items.some((item) => item.current.trim());
}
