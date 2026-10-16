/**
 * The saved Anbieterstand as Markdown: what the SEO-Berater receives on approval and what
 * Transkripte offers as a download. Pure and free of Node APIs, so the browser can use it.
 */

import type { AnbieterItem } from "@/lib/dt/transcripts/workshop-model";

export function buildCurrentAnbieterMarkdown(input: {
  organisationName: string;
  items: Pick<AnbieterItem, "label" | "current">[];
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
    lines.push(`## ${item.label}`, item.current.trim(), "");
  }
  if (open.length > 0) {
    lines.push(
      "## Noch offen",
      "Diese Punkte wurden nicht belegt. Nicht erfinden:",
      ...open.map((item) => `- ${item.label}`),
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
