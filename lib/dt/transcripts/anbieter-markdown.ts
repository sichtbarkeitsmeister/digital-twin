/**
 * The saved Anbieterstand as Markdown: what the SEO-Berater receives on approval and what
 * Transkripte offers as a download. Pure and free of Node APIs, so the browser can use it.
 */

import type { AnbieterItem } from "@/lib/dt/transcripts/workshop-model";

/**
 * What must not be used: the guard rails out of the internal notes, and every matter the
 * sources contradict each other on. Neither side of a contradiction is handed on as a fact.
 */
export function anbieterLeitplanken(input: {
  items: Pick<AnbieterItem, "label" | "conflicts">[];
  guardrails?: string[];
}): { guardrails: string[]; unresolved: string[] } {
  const guardrails = [...new Set((input.guardrails ?? []).map((rule) => rule.trim()).filter(Boolean))];
  const unresolved = input.items.flatMap((item) =>
    (item.conflicts ?? []).map((conflict) =>
      conflict.topic.trim() ? `${item.label}: ${conflict.topic.trim()}` : `${item.label}: ein Sachverhalt mit widersprüchlichen Angaben`,
    ),
  );
  return { guardrails, unresolved: [...new Set(unresolved)] };
}

/**
 * The same as one section for readers that look for blocked statements in the Anbieter
 * sections (the content pipeline): a heading with a release note and one item per rule.
 */
export function anbieterLeitplankenSection(input: Parameters<typeof anbieterLeitplanken>[0]): {
  label: string;
  current: string;
} | null {
  const { guardrails, unresolved } = anbieterLeitplanken(input);
  if (guardrails.length === 0 && unresolved.length === 0) return null;
  return {
    label: "Leitplanken",
    current: [
      "Nicht verwenden, auch nicht sinngemäß:",
      ...guardrails.map((rule) => `- ${rule}`),
      ...unresolved.map((topic) => `- ${topic} (Angaben widersprechen sich, bis zur Klärung nicht verwenden)`),
    ].join("\n"),
  };
}

export function buildCurrentAnbieterMarkdown(input: {
  organisationName: string;
  items: Pick<AnbieterItem, "label" | "current" | "conflicts">[];
  /** Prohibitions from the internal notes. The notes themselves never go in here. */
  guardrails?: string[];
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
  const { guardrails, unresolved } = anbieterLeitplanken(input);
  if (guardrails.length > 0) {
    lines.push(
      "## Leitplanken (verbindlich)",
      "Diese Vorgaben gelten für jeden Text. Sie sind Verbote, keine Fakten:",
      ...guardrails.map((rule) => `- ${rule}`),
      "",
    );
  }
  if (unresolved.length > 0) {
    lines.push(
      "## Nicht verwenden, bis geklärt",
      "Zu diesen Sachverhalten widersprechen sich die Quellen. Keine Angabe dazu verwenden, auch nicht sinngemäß:",
      ...unresolved.map((topic) => `- ${topic}`),
      "",
    );
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
